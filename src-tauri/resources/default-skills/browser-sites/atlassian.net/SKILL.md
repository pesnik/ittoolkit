---
name: browser-sites/atlassian.net
description: Browser automation guidance for Jira and Confluence — ticket creation, issue search, field filling, service desk
disable-model-invocation: true
---

# Jira / Confluence (Atlassian Cloud) — Browser Automation Guide

## DOM & ARIA Patterns

Jira Cloud uses Atlaskit components. `data-testid` is the most stable attribute; many interactive elements also have `aria-label`.

- Global top nav: `[data-testid="navigation-container"]` — readySelector
- Create button: `[data-testid="navigation-item--create"]` or `[aria-label="Create"]`
- Issue summary field: `[data-testid="issue.views.field.summary.edit-button"]` or `#summary`
- Description editor: `[data-testid="issue.views.field.rich-text.editor-container"]`
- Priority select: `[data-testid="issue.views.field.priority.priority-field"]`
- Assignee field: `[data-testid="issue.views.field.assignee.view"]`
- Labels field: `[data-testid="issue.views.field.labels.view"]`
- Submit / Create button in dialog: `[data-testid="create-issue.form.create-button"]`
- Issue type selector: `[data-testid="issue-create.ui.fields.issue-type-field"]`
- Project selector: `[data-testid="issue-create.ui.fields.project-field"]`
- Service desk "Raise a request" form: `[data-testid="sd-issue-create-form"]`

## Standard Flows

### Create a Jira issue (standard project)
1. `browser_navigate` → `https://{org}.atlassian.net/jira/`
2. Wait for `[data-testid="navigation-container"]`
3. Click the "Create" button: `[data-testid="navigation-item--create"]`
4. Observe — a Create Issue modal opens
5. Select project from project dropdown if needed
6. Select issue type (Bug, Story, Task, etc.)
7. Fill "Summary" field (`#summary` or `[data-testid*="summary"]`)
8. Fill "Description" via the rich text editor
9. Set Priority, Assignee, Labels as needed
10. Click `[data-testid="create-issue.form.create-button"]`
11. After creation, the URL changes to `.../browse/{PROJECT-KEY}-{NUMBER}` — extract this as the ticket ID

### Create a Jira Service Desk request
1. `browser_navigate` → `https://{org}.atlassian.net/jira/servicedesk/`
2. Select the service desk project
3. Click "Raise a request" / "New request"
4. Fill the request type form (Summary, Description, Affected user)
5. Submit — URL changes to `.../servicedesk/customer/portal/{id}/...`

### Search for an issue
1. Click the search icon or use the keyboard shortcut `/`
2. Observe — quick search dialog appears
3. Type issue key (e.g. `ITSUP-123`) or keywords
4. Press Enter or click the top result

### Update a field on an existing issue
1. Navigate to the issue URL (`.../browse/{KEY}`)
2. Click the field to edit (most fields are click-to-edit)
3. Update the value
4. Click outside or press Tab/Enter to save

## Known Gotchas

- **Rich text editor**: Jira uses Atlaskit Editor for description — it's a ProseMirror contenteditable. Use `browser_act type` which uses `fill()`. For markdown, type directly; Jira auto-converts `**bold**` and `- lists`.
- **React Select dropdowns**: Priority, Assignee, Labels use React Select with virtual lists. After clicking, type to filter options; click the matching option from the dropdown list.
- **Modal timing**: The Create Issue modal has a ~500ms animation. The readySelector catches page load but not modal render — `browser_observe` after clicking Create.
- **Project-specific fields**: Custom fields (e.g. "Team", "Sprint", "Story Points") vary per project — they appear between Description and the submit button.
- **Service desk vs software projects**: Service desk URLs use `/servicedesk/customer/` path; software projects use `/jira/software/`. Different DOM.
- **SSO redirect**: `*.atlassian.net` may redirect to a company SSO provider on first load — handle login before automation begins.
- **Ticket ID extraction**: After issue creation, the success notification shows "Issue {KEY} created" with a link. Alternatively, parse the URL: `.../browse/PROJ-123`.

## Failure Recovery

If the Create button is not found:
1. The nav may be in compact mode — look for `[aria-label="Create"]` without the testid
2. Try pressing `c` keyboard shortcut (global Jira shortcut for Create Issue)

If a dropdown option doesn't appear:
1. Clear the current value and retype more slowly
2. The dropdown uses virtual scrolling — the option may exist but be off-screen
3. Use `browser_mark` to visually identify available options
