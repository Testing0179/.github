const fetch = require('node-fetch-native');

/**
 * Format unassignments into a human‐readable string.
 */
const formatUnassignments = (unassignments) => {
  if (unassignments.length === 0) return '';

  // Group unassignments by issue
  const groupedByIssue = unassignments.reduce((acc, curr) => {
    const key = `${curr.repo}#${curr.issueNumber}`;
    if (!acc[key]) {
      acc[key] = {
        repo: curr.repo,
        owner: curr.owner,
        issueNumber: curr.issueNumber,
        issueUrl: curr.issueUrl,
        users: []
      };
    }
    acc[key].users.push(curr.user);
    return acc;
  }, {});

  // Format the grouped unassignments
  return Object.values(groupedByIssue)
    .map(({ users, repo, issueNumber, issueUrl }) =>
      `${users.map(u => `@${u}`).join(', ')} from <${issueUrl}|${repo}#${issueNumber}>`
    )
    .join(', ');
};

/**
 * Fetch all open issues (excluding pull requests) using pagination.
 */
async function getAllIssues(owner, repo) {
  const allIssues = [];
  let page = 1;
  const perPage = 100;
  
  while (true) {
    console.log(`Fetching page ${page} of issues...`);
    const issuesUrl = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=${perPage}&page=${page}`;
    try {
      const response = await fetch(issuesUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Your-App-Name'
        }
      });
      if (!response.ok) {
        throw new Error(`Error fetching issues page ${page}: ${response.statusText}`);
      }
      const issues = await response.json();
      // Filter out pull requests (issues that include a "pull_request" property)
      const filteredIssues = issues.filter(issue => !issue.pull_request);
      
      if (filteredIssues.length === 0) {
        break; // No more issues to fetch
      }
      
      allIssues.push(...filteredIssues);
      console.log(`Fetched ${filteredIssues.length} issues from page ${page}`);
      
      if (filteredIssues.length < perPage) {
        break; // Last page
      }
      page++;
    } catch (error) {
      console.error(`Error fetching issues page ${page}:`, error);
      break;
    }
  }
  
  console.log(`Total issues fetched (excluding PRs): ${allIssues.length}`);
  return allIssues;
}

/**
 * Check for linked PRs for a given issue using several methods:
 *  1. Query the issue timeline for cross-referenced events
 *  2. Search for open PRs that mention this issue
 *  3. Parse the issue body for PR references
 */
const checkLinkedPRs = async (issue, owner, repo) => {
  try {
    if (!issue || !issue.number) {
      console.error('Invalid issue object received:', issue);
      return new Set();
    }

    let linkedPRs = new Set();

    // Method 1: Use timeline events (Development section)
    try {
      console.log(`Checking Development section for linked PRs (issue #${issue.number}) via timeline events`);
      const timelineUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issue.number}/timeline?per_page=100`;
      const timelineResponse = await fetch(timelineUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.mockingbird-preview+json',
          'User-Agent': 'Your-App-Name'
        }
      });
      if (timelineResponse.ok) {
        const timelineEvents = await timelineResponse.json();
        for (const event of timelineEvents) {
          if (
            event.event === 'cross-referenced' &&
            event.source &&
            event.source.issue &&
            event.source.issue.pull_request // Indicates the event came from a PR
          ) {
            const prNumber = event.source.issue.number;
            // Optionally verify PR state by fetching PR details
            const prUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
            const prResponse = await fetch(prUrl, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Your-App-Name'
              }
            });
            if (prResponse.ok) {
              const prData = await prResponse.json();
              if (prData.state === 'open') {
                console.log(`✅ Found linked PR #${prNumber} via timeline event`);
                linkedPRs.add(prNumber);
              }
            } else {
              console.error(`Error fetching PR details for #${prNumber}: ${prResponse.statusText}`);
            }
          }
        }
      } else {
        console.error(`Error fetching timeline for issue #${issue.number}: ${timelineResponse.statusText}`);
      }
    } catch (timelineError) {
      console.error(`Timeline method error for issue #${issue.number}:`, timelineError.message);
    }

    // Method 2: Search for PRs that mention this issue
    try {
      const searchQuery = `repo:${owner}/${repo} type:pr is:open ${issue.number} in:body,title`;
      console.log(`Searching for PRs with query: ${searchQuery}`);
      const searchUrl = `https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}`;
      const searchResponse = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Your-App-Name'
        }
      });
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.items) {
          const foundPRs = searchData.items.filter(item => item.pull_request);
          console.log(`Found ${foundPRs.length} PRs mentioning this issue through search`);
          for (const pr of foundPRs) {
            const prUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}`;
            const prResponse = await fetch(prUrl, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Your-App-Name'
              }
            });
            if (prResponse.ok) {
              const prData = await prResponse.json();
              if (prData.state === 'open') {
                linkedPRs.add(prData.number);
              }
            } else {
              console.error(`Error fetching PR details for search result #${pr.number}: ${prResponse.statusText}`);
            }
          }
        }
      } else {
        console.error(`Search API error: ${searchResponse.statusText}`);
      }
    } catch (searchError) {
      console.log('Search API error:', searchError.message);
    }

    // Method 3: Check issue body for PR references
    if (issue.body) {
      const prReferences = new Set();
      const patterns = [
        /#(\d+)/g,
        new RegExp(`https?://github\\.com/${owner}/${repo}/pull/(\\d+)`, 'g'),
        /(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s*:?\s*#(\d+)/gi
      ];

      for (const pattern of patterns) {
        const matches = [...issue.body.matchAll(pattern)];
        for (const match of matches) {
          if (match?.[1]) {
            const prNumber = parseInt(match[1], 10);
            if (!isNaN(prNumber)) {
              prReferences.add(prNumber);
            }
          }
        }
      }
      console.log(`Found ${prReferences.size} PR references in issue body`);
      for (const prNumber of prReferences) {
        const prUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
        const prResponse = await fetch(prUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Your-App-Name'
          }
        });
        if (prResponse.ok) {
          const prData = await prResponse.json();
          if (prData.state === 'open') {
            linkedPRs.add(prNumber);
          }
        } else {
          console.error(`Error fetching PR #${prNumber} from issue body: ${prResponse.statusText}`);
        }
      }
    }

    return linkedPRs;
  } catch (error) {
    console.error(`Error in checkLinkedPRs for issue #${issue.number}:`, error);
    return new Set();
  }
};

/**
 * Check if a given username is an active member.
 * First, we check if the user is the repository owner.
 * Then, we check if the user is a member of the organization (if applicable).
 */
const checkUserMembership = async (owner, repo, username) => {
  try {
    // Check repository details
    const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const repoResponse = await fetch(repoUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Your-App-Name'
      }
    });
    if (!repoResponse.ok) {
      throw new Error(`Failed to fetch repository details: ${repoResponse.statusText}`);
    }
    const repoData = await repoResponse.json();
    if (repoData.owner.login.toLowerCase() === username.toLowerCase()) {
      console.log(`${username} is the repository owner`);
      return true;
    }
    // Check organization membership (if the repo owner is an organization)
    const membershipUrl = `https://api.github.com/orgs/${owner}/members/${username}`;
    const membershipResponse = await fetch(membershipUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Your-App-Name'
      }
    });
    if (membershipResponse.ok) {
      console.log(`${username} is an organization member`);
      return true;
    } else {
      console.log(`${username} is not an organization member`);
      return false;
    }
  } catch (error) {
    console.error(`Error checking user membership for ${username}:`, error);
    return false;
  }
};

/**
 * Main function.
 * For each open issue (excluding PRs) that is inactive and has assignees:
 *  - If there are no linked open PRs
 *  - Then, determine which assignees are inactive (not a site admin and not a member)
 *  - Update the issue’s assignees (remove inactive users)
 *  - Add a comment explaining the unassignment
 *  - Record the unassignments for reporting
 */
module.exports = async ({ context, core }) => {
  try {
    const unassignments = [];
    const inactivityPeriodInMinutes = 1;
    const [owner, repo] = context.payload.repository.full_name.split('/');
    console.log(`Processing repository: ${owner}/${repo}`);

    // Test API access by getting repository details
    try {
      const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
      const repoResponse = await fetch(repoUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Your-App-Name'
        }
      });
      if (!repoResponse.ok) {
        throw new Error(`Failed to fetch repository: ${repoResponse.statusText}`);
      }
      const repository = await repoResponse.json();
      console.log('Successfully authenticated with GitHub and verified repository access');
      console.log(`Repository: ${repository.full_name}`);
    } catch (authError) {
      console.error('Authentication error details:', {
        message: authError.message
      });
      throw new Error(`Repository access failed. Please check your token permissions. Error: ${authError.message}`);
    }

    // Get all open issues (excluding PRs)
    const issues = await getAllIssues(owner, repo);
    console.log(`Processing ${issues.length} open issues`);

    for (const issue of issues) {
      if (!issue || !issue.number) {
        console.error('Skipping invalid issue:', issue);
        continue;
      }

      console.log(`\nProcessing issue #${issue.number}`);
      console.log('Issue data:', {
        number: issue.number,
        title: issue.title,
        assignees: issue.assignees ? issue.assignees.length : 0,
        updated_at: issue.updated_at
      });

      const assignees = issue.assignees || [];
      if (assignees.length === 0) {
        console.log(`Issue #${issue.number} has no assignees, skipping`);
        continue;
      }

      // Check if the issue is inactive (based on updated_at)
      const lastActivity = new Date(issue.updated_at);
      const now = new Date();
      if (now - lastActivity <= inactivityPeriodInMinutes * 60 * 1000) {
        console.log(`Issue #${issue.number} is still active, skipping`);
        continue;
      }

      console.log(`Checking for linked PRs for issue #${issue.number}`);
      const linkedPRs = await checkLinkedPRs(issue, owner, repo);
      if (linkedPRs.size > 0) {
        console.log(`Issue #${issue.number} has open linked PRs, skipping unassignment`);
        continue;
      }

      console.log(`Processing inactive issue #${issue.number} with no open linked PRs`);
      const inactiveAssignees = [];
      const activeAssignees = [];

      for (const assignee of assignees) {
        if (!assignee || !assignee.login) {
          console.log('Skipping invalid assignee:', assignee);
          continue;
        }
        if (assignee.site_admin || await checkUserMembership(owner, repo, assignee.login)) {
          activeAssignees.push(assignee.login);
          console.log(`${assignee.login} is active, keeping assignment`);
        } else {
          inactiveAssignees.push(assignee.login);
          console.log(`${assignee.login} is inactive, will be unassigned`);
        }
      }

      if (inactiveAssignees.length === 0) {
        console.log(`No inactive assignees for issue #${issue.number}, skipping`);
        continue;
      }

      try {
        // Update the issue to set its assignees to the active ones only.
        const updateUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issue.number}`;
        const updateResponse = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Your-App-Name',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ assignees: activeAssignees })
        });
        if (!updateResponse.ok) {
          throw new Error(`Failed to update issue: ${updateResponse.statusText}`);
        }
        console.log(`Successfully updated issue #${issue.number} (unassigned inactive users)`);

        // Add a comment to the issue explaining the unassignment.
        const mentionList = inactiveAssignees.map(login => `@${login}`).join(', ');
        const commentUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issue.number}/comments`;
        const commentResponse = await fetch(commentUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Your-App-Name',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            body: `Automatically unassigning ${mentionList} due to inactivity. ${mentionList}, if you're still interested or already working on this issue, please let us know and we will reassign you. Thank you!`
          })
        });
        if (!commentResponse.ok) {
          throw new Error(`Failed to create comment: ${commentResponse.statusText}`);
        }
        console.log(`Added comment to issue #${issue.number}`);

        // Record unassignments for reporting
        inactiveAssignees.forEach(login => {
          unassignments.push({
            user: login,
            repo,
            owner,
            issueNumber: issue.number,
            issueUrl: `https://github.com/${owner}/${repo}/issues/${issue.number}`
          });
        });
      } catch (issueError) {
        console.error(`Error processing issue #${issue.number}:`, {
          message: issueError.message
        });
        if (issueError.message.includes('403')) {
          throw new Error('Token lacks necessary permissions. Ensure it has "issues" and "write" access.');
        }
      }
    }

    const formattedUnassignments = formatUnassignments(unassignments);
    console.log('Unassignments completed:', unassignments.length);

    try {
      core.setOutput('unassignments', formattedUnassignments);
      return formattedUnassignments;
    } catch (error) {
      console.error('Error setting output:', error);
      core.setFailed(error.message);
    }
  } catch (error) {
    console.error('Action failed:', error);
    console.error('Full error details:', error);
    core.setFailed(error.message);
    return '';
  }
};
