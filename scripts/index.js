import { Octokit } from '@octokit/rest';
import * as core from '@actions/core';  // Import core for failure handling
import fetch from 'node-fetch';

async function unassignInactiveContributors() {
  try {
    // Retrieve inputs and secrets
    const githubToken = core.getInput("githubToken", { required: true });
    const inactivityPeriodInMinutes = 1;

    // Validate inputs
    if (!githubToken) {
      core.setFailed("GitHub token is missing.");
      return;
    }
   

    // Initialize Octokit
    const octokit = new Octokit({
      auth: token,
      request: {
          fetch: fetch
      }
    });

    const owner = "SukhvirKooner"; 
    const repo = "test-actions"; 

    // Fetch open issues
    const { data: issues } = await octokit.issues.listForRepo({
      owner,
      repo,
      state: "open",
    });

    const now = new Date();

    for (const issue of issues) {
      if (issue.assignee) {
        const assignee = issue.assignee.login;

        // Check for activity in issue events
        const { data: events } = await octokit.issues.listEventsForTimeline({
          owner,
          repo,
          issue_number: issue.number,
        });

        const latestActivity = events
          .map((event) => new Date(event.created_at))
          .reduce((latest, current) => (current > latest ? current : latest), new Date(0));

        const timeSinceLastActivity = (now - latestActivity) / (1000 * 60); // In minutes

        if (
          timeSinceLastActivity > inactivityPeriodInMinutes &&
          !issue.pull_request // Exclude issues with linked PRs
        ) {
          // Unassign and comment
          await octokit.issues.removeAssignees({
            owner,
            repo,
            issue_number: issue.number,
            assignees: [assignee],
          });

          await octokit.issues.createComment({
            owner,
            repo,
            issue_number: issue.number,
            body: `Automatically unassigning @${assignee} due to inactivity. @${assignee}, if you're still interested in this issue or already have work in progress, please message us here, and we'll assign you again. Thank you!`,
          });

          console.log(`Unassigned @${assignee} from issue #${issue.number}`);
        }
      }
    }
  } catch (error) {
    core.setFailed(`Error processing issues: ${error.message}`);
  }
}

// Run the function
unassignInactiveContributors();
