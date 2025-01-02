const core = require('@actions/core');
const fetch = require('node-fetch-native');

async function run() {
  try {
    const { Octokit } = await import('@octokit/rest');

    const token = process.env.WEB_Token;
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    
    if (!token) {
      throw new Error('No authentication token provided. Please ensure WEB_Token is set in the workflow.');
    }

    if (!slackWebhookUrl) {
      throw new Error('Slack webhook URL missing. Please ensure SLACK_WEBHOOK_URL is set in the workflow.');
    }

    console.log('Token exists:', !!token);
    console.log('Slack webhook URL exists:', !!slackWebhookUrl);

    const unassignments = [];

    const inactivityPeriodInMinutes = 1;

    const repository = process.env.GITHUB_REPOSITORY;
    if (!repository) {
      throw new Error('GITHUB_REPOSITORY environment variable is not set');
    }

    const [owner, repo] = repository.split('/');
    console.log(`Processing repository: ${owner}/${repo}`);

    // Function to send Slack notification via webhook

    async function sendSlackNotification(unassignments) {
      if (unassignments.length === 0) return;

      try {
        let message = "Automatically unassigned:\n";
      unassignments.forEach(({ user, repo, issueNumber, owner }) => {
      const issueUrl = `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
      message += `• '${user}' from <${issueUrl}|${repo}#${issueNumber}>\n`;
    });

        const response = await fetch(slackWebhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ text: message })
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        console.log('Slack notification sent successfully');
      } catch (error) {
        console.error('Error sending Slack notification:', error);
      }
    }

    const octokit = new Octokit({
      auth: token,
      request: {
        fetch: fetch
      }
    });

    // Function to check user membership and ownership
    const checkUserMembership = async (owner, repo, username) => {
      try {
        // Check if the user is an owner of the repository
        const repoDetails = await octokit.rest.repos.get({
          owner,
          repo
        });

        // Check if the repository owner matches the username
        if (repoDetails.data.owner.login === username) {
          return true; // User is the repository owner
        }

        // Check if the user is an organization member
        try {
          const membershipResponse = await octokit.rest.orgs.getMembershipForUser({
            org: owner,
            username: username
          });
          return true; // User is a member
        } catch (orgError) {
          return false; // Not a member
        }
      } catch (error) {
        console.error(`Error checking user membership for ${username}:`, error);
        return false;
      }
    };

    try {
      const authUser = await octokit.rest.users.getAuthenticated();
      console.log('Successfully authenticated with GitHub as:', authUser.data.login);
    } catch (authError) {
      console.error('Authentication error details:', authError);
      throw new Error(`Authentication failed: ${authError.message}. Please check your token permissions.`);
    }

    // List open issues
    const issues = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      per_page: 100,
    });
    console.log(`Found ${issues.data.length} open issues`);

    for (const issue of issues.data) {
      console.log(issue);
      
      const assignee = issue.assignee;
      
      // Modified check to include user membership, ownership, and role verification
      if (!assignee || assignee.site_admin || await checkUserMembership(owner, repo, assignee.login)) {
        console.log('Skipping unassignment due to user role');
        continue;
      }

      console.log(`\nChecking issue #${issue.number}:`);
      console.log('Issue data:', {
        number: issue.number,
        title: issue.title,
        assignee: assignee.login,
        has_pr_field: !!issue.pull_request,
        updated_at: issue.updated_at
      });

      // Enhanced PR checking function
      const checkLinkedPRs = async () => {
        try {
          // Method 1: Check direct PR field
          let linkedPRs = [];
          if (issue.pull_request) {
            const prNumber = issue.pull_request.number;
            const prDetails = await octokit.rest.pulls.get({
              owner,
              repo,
              pull_number: prNumber
            });
            linkedPRs.push(prDetails.data);
          }

          // Method 2: Check timeline events for PR references with status check
          const timeline = await octokit.rest.issues.listEventsForTimeline({
            owner,
            repo,
            issue_number: issue.number,
            per_page: 100
          });

          // Find PR references in timeline
          const prReferences = timeline.data.filter(event => 
            (event.event === 'cross-referenced' || 
             event.event === 'connected' || 
             event.event === 'referenced') && 
            event.source && 
            event.source.type === 'pull_request'
          );

          // Fetch details for each referenced PR and check its status
          for (const ref of prReferences) {
            try {
              const prDetails = await octokit.rest.pulls.get({
                owner,
                repo,
                pull_number: ref.source.issue.number
              });
              
              // Add PR to list
              linkedPRs.push(prDetails.data);
            } catch (prFetchError) {
              console.error(`Error fetching PR details:`, prFetchError);
            }
          }

          // Method 3: Check issue body for PR links
          const prLinkRegex = /(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#(\d+)/gi;
          const bodyMatches = [...(issue.body || '').matchAll(prLinkRegex)];
          
          for (const match of bodyMatches) {
            try {
              const prNumber = match[1];
              const prDetails = await octokit.rest.pulls.get({
                owner,
                repo,
                pull_number: prNumber
              });
              
              // Add PR to list
              linkedPRs.push(prDetails.data);
            } catch (prFetchError) {
              console.error(`Error fetching PR from body link:`, prFetchError);
            }
          }

          // Check if any linked PRs are open
          const openPRs = linkedPRs.filter(pr => pr.state === 'open');
          
          if (openPRs.length > 0) {
            console.log(`Issue #${issue.number} has open PRs:`, 
              openPRs.map(pr => `#${pr.number} (${pr.state})`));
            return true;
          }

          console.log(`No open linked PRs found for issue #${issue.number}`);
          return false;
        } catch (error) {
          console.error(`Error checking PR links for issue #${issue.number}:`, error);
          return false;
        }
      };

      const lastActivity = new Date(issue.updated_at);
      const now = new Date();
      
      if (now - lastActivity > inactivityPeriodInMinutes * 60 * 1000) {
        const hasOpenPRs = await checkLinkedPRs();
        
        if (hasOpenPRs) {
          console.log(`Skipping issue #${issue.number} as it has open PRs`);
          continue;
        }

        console.log(`Processing inactive issue #${issue.number} with no open PRs`);
        
        try {
          // Unassign user
          await octokit.rest.issues.update({
            owner,
            repo,
            issue_number: issue.number,
            assignees: [],
          });

          console.log(`Successfully unassigned user from issue #${issue.number}`);

          // Add comment
          await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: issue.number,
            body: `Automatically unassigning @${assignee.login} due to inactivity. @${assignee.login}, if you're still interested in this issue or already have work in progress, please message us here, and we'll assign you again. Thank you!`,
          });

          console.log(`Added comment to issue #${issue.number}`);

          unassignments.push({
            user: assignee.login,
            repo: repo,
            owner: owner,  
            issueNumber: issue.number
          });

        } catch (issueError) {
          console.error('Full error details:', issueError);
          console.error(`Error processing issue #${issue.number}:`, issueError.message);
          if (issueError.status === 403) {
            throw new Error('Token lacks necessary permissions. Ensure it has "issues" and "write" access.');
          }
        }
      }
    }

    if (unassignments.length > 0) {
      await sendSlackNotification(unassignments);
    }

    
  } catch (error) {
    console.error('Full error details:', error);
    console.error('Action failed:', error.message);
    core.setFailed(error.message);
  }
}

run();