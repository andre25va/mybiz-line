# MyBiz Line — Agent Integration Guide
## How Your AI Talks to the MyBiz Line Agent

This guide teaches your AI (GPT-4o, Claude, Grok, or any other) how to interact with the MyBiz Line agent to take actions, retrieve data, and coordinate on behalf of the business owner.

---

## What the Agent Can Do

The MyBiz Line agent (powered by Tasklet) can:

| Action | Description |
|---|---|
| **Read contacts** | Look up any contact by name or phone |
| **Read messages** | Pull recent SMS thread history for a contact |
| **Draft a reply** | Queue a reply for owner approval — never auto-sends |
| **Create a task** | Add a follow-up task to a contact |
| **Set a reminder** | Schedule an SMS reminder to fire at a set time |
| **Update contact status** | Change lead → active → closed, etc. |
| **Read voicemails** | Pull transcript of missed-call voicemails |
| **Read call log** | See recent calls for a contact |
| **Add a note** | Append a note to a contact's profile |

---

## How to Call the Agent

When your AI needs the agent to act, it outputs a structured command block. The MyBiz Line app reads this and routes it to the agent.

### Command Format

```
AGENT_ACTION:
action: [action name]
params:
  [key]: [value]
  [key]: [value]
reason: [why you're requesting this — one sentence]
```

### Examples

**Look up a contact:**
```
AGENT_ACTION:
action: get_contact
params:
  phone: "+19135551234"
reason: Need full contact details before drafting reply.
```

**Queue a draft reply for approval:**
```
AGENT_ACTION:
action: queue_draft
params:
  contact_phone: "+19135551234"
  message: "Hi! Thanks for reaching out — I'll have a quote ready by tomorrow afternoon."
reason: Client asked for a quote. Draft queued for owner approval.
```

**Create a follow-up task:**
```
AGENT_ACTION:
action: create_task
params:
  contact_phone: "+19135551234"
  title: "Send countertop quote to Maria"
  due_date: "2026-10-08"
reason: Client requested a quote — task created to follow up.
```

**Set a reminder:**
```
AGENT_ACTION:
action: set_reminder
params:
  contact_phone: "+19135551234"
  message: "Follow up with Maria about countertop quote"
  reminder_time: "2026-10-08T14:00:00-05:00"
reason: No response in 2 days — set reminder to follow up.
```

**Add a note to contact:**
```
AGENT_ACTION:
action: add_note
params:
  contact_phone: "+19135551234"
  note: "Interested in granite countertops, ~40 sq ft kitchen. Budget flexible."
reason: Captured key details from conversation.
```

**Update contact status:**
```
AGENT_ACTION:
action: update_status
params:
  contact_phone: "+19135551234"
  status: "active"
reason: Client confirmed interest — moving from lead to active.
```

---

## Rules for Your AI

1. **Always queue drafts — never claim a message was sent**
2. **Only use `queue_draft` for client-facing messages** — the owner approves before anything sends
3. **Be specific in the `reason` field** — the agent uses this for logging
4. **One action per block** — don't chain multiple actions in one output
5. **Use E.164 phone format** — `+1XXXXXXXXXX`
6. **Never fabricate contact data** — only use what the agent returns

---

## Training Tips for Your AI

When setting up your AI with this integration, include this in its system prompt:

> "When you need to take an action in MyBiz Line (look up a contact, queue a draft, create a task, set a reminder, add a note, or update a status), output an AGENT_ACTION block using the format in the integration guide. The MyBiz Line agent will execute it and return the result. Never claim you sent a message — always use queue_draft and wait for owner approval."

---

## Response Format from Agent

After executing an action, the agent returns:

```json
{
  "action": "queue_draft",
  "status": "success",
  "data": {
    "draft_id": "uuid",
    "contact": "Maria Gonzalez",
    "message": "Hi! Thanks for reaching out...",
    "queued_at": "2026-10-06T08:00:00-05:00"
  }
}
```

Your AI should confirm the action succeeded before moving on.

---

*MyBiz Line Agent Integration Guide v1.0 — October 2026*
