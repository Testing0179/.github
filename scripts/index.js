import { Octokit } from '@octokit/rest';
import * as core from '@actions/core';
import fetch from 'node-fetch';

async function run() {
  try {
    // Get token from github.token default or input
    const token = core.getInput('github_token') || core.getInput('token');
    
    if (!token) {
      throw new Error('No authentication token provided. Please ensure GITHUB_TOKEN is set in the workflow.');
    }

    const inactivityPeriodInMinutes = 1;

    // Get repository context
    const repository = process.env.GITHUB_REPOSITORY;
    if (!repository) {
      throw new Error('GITHUB_REPOSITORY environment variable is not set');
    }

    const [owner, repo] = repository.split('/');
    console.log(`Processing repository: ${owner}/${repo}`);

    // Initialize Octokit with authentication
    const octokit = new Octokit({
      auth: `token ${token}`,
      request: {
        fetch: fetch
      }
    });

    // Verify authentication
    try {
      await octokit.rest.users.getAuthenticated();
      console.log('Successfully authenticated with GitHub');
    } catch (authError) {
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
      const assignee = issue.assignee;
      if (assignee && !assignee.site_admin) {
        const lastActivity = new Date(issue.updated_at);
        const now = new Date();
        
        if (now - lastActivity > inactivityPeriodInMinutes * 60 * 1000 && !issue.pull_request) {
          console.log(`Processing issue #${issue.number} assigned to @${assignee.login}`);
          
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
          } catch (issueError) {
            console.error(`Error processing issue #${issue.number}:`, issueError.message);
            if (issueError.status === 403) {
              throw new Error('Token lacks necessary permissions. Ensure it has "issues" and "write" access.');
            }
          }
        }
      }
    }
    
  } catch (error) {
    console.error('Action failed:', error.message);
    core.setFailed(error.message);
  }
}

run();