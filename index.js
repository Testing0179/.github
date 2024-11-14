import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const token = process.env.WEB_TOKEN;
  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  const repo = process.env.GITHUB_REPOSITORY;

  const octokit = new Octokit({ auth: token });

  try {
    const issues = await octokit.rest.issues.list({
      owner,
      repo,
      state: 'open',
      per_page: 100,
    });
    
    for (const issue of issues.data) {
      const assignee = issue.assignee;
      if (assignee && !assignee.site_admin) {
        const lastActivity = new Date(issue.updated_at);
        const inactivityPeriod = 30; // days
        const now = new Date();
        const inactivityPeriodInMinutes = 1;
        // (now - lastActivity > inactivityPeriod * 24 * 60 * 60 * 1000 && !issue.pull_request) for 1 month 
        if (now - lastActivity > inactivityPeriodInMinutes * 60 * 1000 && !issue.pull_request) {
          console.log("checked successfully");

          await octokit.rest.issues.edit({
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
    core.setFailed(error.message);
  }
}
run();
// module.exports = run;
export default run;