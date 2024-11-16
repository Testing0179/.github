import { Octokit } from '@octokit/rest';
import * as core from '@actions/core';  // Import core for failure handling
import fetch from 'node-fetch';


async function run() {
  try {
    // Get token and inactivity period from the inputs
    const token = core.getInput('WEB_Token');
    const inactivityPeriodInMinutes = parseInt(core.getInput('inactivityPeriodInMinutes'), 10);

    // Retrieve repo context from GitHub Actions environment
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');

    
    const octokit = new Octokit({
      auth: process.env.WEB_Token,
      request: {
          fetch: fetch
      }
    });

    // Correct API endpoint to list issues in the repository
    const issues = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      per_page: 100,
    });
    
    for (const issue of issues.data) {
      const assignee = issue.assignee;
      if (assignee && !assignee.site_admin) {
        const lastActivity = new Date(issue.updated_at);
        console.log(lastActivity);
        console.log(assignee);

        const now = new Date();
        console.log(now - lastActivity);
        console.log(inactivityPeriodInMinutes * 60 * 1000);
        
        console.log(now - lastActivity > inactivityPeriodInMinutes * 60 * 1000 );
        
        // Check inactivity period
        if ( now - lastActivity > inactivityPeriodInMinutes * 60 * 1000 && !issue.pull_request) {
          console.log('done');
          
          console.log(`Unassigning @${assignee.login} due to inactivity on issue #${issue.number}`);

          await octokit.rest.issues.update({
            owner,
            repo,
            issue_number: issue.number,
            assignees: [],
          });

          await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: issue.number,
            body: `Automatically unassigning @${assignee.login} due to inactivity. @${assignee.login}, if you're still interested in this issue or already have work in progress, please message us here, and we'll assign you again. Thank you!`,
          });
        }
      }
    }
    
  } catch (error) {
    console.error(error);
    core.setFailed(error.message); // Mark the GitHub Action as failed on error
  }
}

// Run the function
run();