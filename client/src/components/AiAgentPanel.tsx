import React, { useState } from 'react';
import { AtSign, Mic, Terminal, ExternalLink, Copy, Check } from 'lucide-react';
import type { AiAgentProfile } from '../types';

/**
 * The hub on an AI agent's profile: the agent's three
 * representations side by side — the intranet persona you tag, its ElevenLabs
 * voice agent, and its Claude Code skill. The voice widget itself is rendered
 * by the profile page below this panel.
 */
const CopyButton: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable — the value is visible to select by hand */
        }
      }}
      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
      title={`Copy ${label}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

const Card: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="rounded-lg border border-violet-100 bg-white p-4 flex flex-col gap-2">
    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-100 text-violet-700">{icon}</span>
      {title}
    </div>
    <div className="text-sm text-gray-700 space-y-2">{children}</div>
  </div>
);

const NotSetUp: React.FC<{ what: string }> = ({ what }) => (
  <p className="text-gray-500 italic">No {what} for this agent yet.</p>
);

const AiAgentPanel: React.FC<{ agent: AiAgentProfile; name: string }> = ({ agent, name }) => (
  <div className="card p-6 border border-violet-200 bg-gradient-to-br from-violet-50 to-white">
    <h2 className="text-lg font-semibold text-gray-900">Talk to {name}</h2>
    <p className="mt-1 text-sm text-gray-600">The same agent in three places — tag it here, call it by voice, or run it in Claude Code.</p>

    <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card icon={<AtSign className="h-4 w-4" />} title="On the intranet">
        <div className="flex items-center justify-between gap-2">
          <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm">@{agent.handle}</code>
          <CopyButton value={`@${agent.handle}`} label="handle" />
        </div>
        <p>
          {agent.responds_to_mentions
            ? `Tag @${agent.handle} in a forum post or comment and ${name} reads the thread and replies there — or press Message to chat one-to-one.`
            : `${name} is listed here but does not answer mentions yet.`}
        </p>
      </Card>

      <Card icon={<Mic className="h-4 w-4" />} title="ElevenLabs voice agent">
        {agent.elevenlabs_agent_id ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <code className="truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs" title={agent.elevenlabs_agent_id}>
                {agent.elevenlabs_agent_id}
              </code>
              <CopyButton value={agent.elevenlabs_agent_id} label="agent ID" />
            </div>
            <a
              href={`https://elevenlabs.io/app/talk-to?agent_id=${encodeURIComponent(agent.elevenlabs_agent_id)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700"
            >
              Open voice conversation <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <p className="text-xs text-gray-500">Or use the voice widget on this page.</p>
          </>
        ) : (
          <NotSetUp what="voice agent" />
        )}
      </Card>

      <Card icon={<Terminal className="h-4 w-4" />} title="Claude Code skill">
        {agent.skill_command || agent.skill_url ? (
          <>
            {agent.skill_command && (
              <div className="flex items-center justify-between gap-2">
                <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm">{agent.skill_command}</code>
                <CopyButton value={agent.skill_command} label="command" />
              </div>
            )}
            {agent.skill_url && (
              <a
                href={agent.skill_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700"
              >
                Skill source in Google Drive <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <p className="text-xs text-gray-500">Install it locally, then type the command in Claude Code.</p>
          </>
        ) : (
          <NotSetUp what="Claude Code skill" />
        )}
      </Card>
    </div>
  </div>
);

export default AiAgentPanel;
