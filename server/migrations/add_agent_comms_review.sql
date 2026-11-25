-- Comms review by an AI agent (AGENT_COMMS_REVIEW_HANDLE, see server/lib/aiAgents.js):
-- the agent reviews new all-members posts ('comms_review') and, if
-- AGENT_COMMS_REVIEW_GROUPS is set, chosen public channels ('channel_review'),
-- and asks for missing context. Each review is one ai_agent_replies row.
--
-- Safe to re-run: MODIFY to the same value list is a no-op, and it only ever
-- adds values. Apply to each instance database before deploying the code that
-- writes 'channel_review':
--   mysql -h <host> -u <admin> -p <instance_db> < server/migrations/add_agent_comms_review.sql
ALTER TABLE ai_agent_replies
  MODIFY COLUMN `source_type` enum('post','comment','direct_message','group_message','comms_review','channel_review') NOT NULL;
