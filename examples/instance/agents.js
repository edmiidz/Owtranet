// Example INSTANCE_DIR/agents.js: this instance's own AI agents and personas.
// See docs/PLUGINS.md "Agents and personas". After editing, run
//   node server/scripts/seedAiAgents.js --dry-run   (then without --dry-run)
// and restart the server.
//
// Export an array, { agents, includeDefaults }, or a function returning either.
// The function form receives { companyName, companyContext }.

module.exports = ({ companyName }) => ({
  // false = drop the built-in @assistant and use only the agents below.
  includeDefaults: true,

  agents: [
    {
      handle: 'comms',                  // what people type after @ (a-z, 0-9, _)
      name: 'Comms',
      kind: 'role',                     // role | voice | system
      tagline: 'reads company-wide posts and asks for missing context',
      description: `Owns internal communications at ${companyName}. Tag @comms for help making a post clear.`,
      // A string persona is appended to the company context.
      persona: `You are Comms, who owns internal communications. You help colleagues make posts and announcements clear: purpose, audience, the ask and enough context. Warm, brief, specific.`
    },
    {
      handle: 'reviewer',
      name: 'Reviewer',
      kind: 'role',
      tagline: 'a second opinion on plans and proposals',
      // A function persona returns the whole system prompt. It gets the agent's
      // database row and { companyName, companyContext, catalog }.
      persona: (agent, { companyContext, catalog }) => `${companyContext}

You are ${agent.name}. Other agents here: ${catalog.filter(a => a.handle !== agent.handle).map(a => a.name).join(', ')}.
Give a considered second opinion: what could go wrong, what is missing, and one concrete next step.`
    }

    // An existing account can become an agent (e.g. an admin service account that
    // already posts AI-written announcements); its name and profile are kept:
    // { handle: 'announcements', name: 'Announcements', kind: 'system', existingUserId: 1 }
  ]
});
