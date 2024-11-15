import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';

// Load environment variables from .env file if running locally
dotenv.config();

async function run() {
  try {
    // Get token and inactivity period from environment variables
    const token = process.env.WEB_TOKEN;
    const inactivityPeriodInMinutes = parseInt(process.env.INACTIVITY_PERIOD || '15', 10); // Default to 15 minutes if not set

    if (!token) {
      throw new Error('GitHub token (WEB_TOKEN) is missing.');
    }

    if (!process.env.GITHUB_REPOSITORY) {
      throw new Error('GITHUB_REPOSITORY environment variable is missing.');
    }

    // Retrieve repo context from GitHub Actions environment
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');

    const octokit = new Octokit({ auth: token });

    // Fetch open issues in the repository
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
        const now = new Date();

        // Check inactivity period
        if (now - lastActivity > inactivityPeriodInMinutes * 60 * 1000 && !issue.pull_request) {
          console.log(`Unassigning @${assignee.login} due to inactivity on issue #${issue.number}`);

          // Unassign the user
          await octokit.rest.issues.update({
            owner,
            repo,
            issue_number: issue.number,
            assignees: [],
          });

          // Add a comment to the issue
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
    console.error('Error:', error.message);
    process.exit(1); // Exit with failure status
  }
}

// Run the function
run();

  export default run;