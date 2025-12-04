<!-- PROJECT-MANIFEST:START -->
```json
{
  "schemaVersion": 1,
  "projectId": "example-project",
  "name": "Example Project",
  "repo": "owner/example-project",
  "visibility": "public",
  "status": "active",
  "domain": "music",
  "type": "webapp",
  "lastUpdated": "2025-01-15",
  "links": {
    "prod": "https://example.com",
    "staging": "https://staging.example.com"
  },
  "tags": ["webapp", "typescript", "react"]
}
```
<!-- PROJECT-MANIFEST:END -->

# Example Project - Project Summary

<!-- 
  The manifest block above contains machine-readable metadata about the project.
  This block MUST be present at the top of the file and MUST be valid JSON.
  The parser extracts this block to populate the Project Atlas dashboard.
  
  Required fields:
  - schemaVersion: Always 1 for v1
  - projectId: Unique identifier (lowercase, hyphens)
  - name: Display name
  - repo: GitHub owner/repo-name
  - visibility: "public" | "staging" | "private"
  - status: "active" | "mvp" | "paused" | "archived"
  - domain: "music" | "minecraft" | "management" | "other" (field/area categorization)
  - type: "webapp" | "microservice" | "tool" | "cli" | "library" | "other" (technical architecture)
  - lastUpdated: ISO date string (YYYY-MM-DD)
  - links: Object with "prod" and "staging" (strings or null)
  - tags: Array of strings
-->

## Project Overview

<!-- 
  This section provides a high-level description of the project.
  Include: purpose, main goals, target audience, key value proposition.
-->

**Example Project** is a [brief description of what the project does and why it exists].

### Key Features

- Feature 1: Description
- Feature 2: Description
- Feature 3: Description

---

## Tech Stack

<!-- 
  Document the technologies, frameworks, and tools used in the project.
  This helps with understanding dependencies and technical context.
-->

- **Frontend**: [Framework/Library]
- **Backend**: [Framework/Service]
- **Database**: [Database System]
- **Deployment**: [Platform/Service]
- **Other Tools**: [Additional tools]

---

## Current Focus

<!-- 
  Describe what you're actively working on right now.
  This helps track immediate priorities and current development state.
-->

Currently focused on [main current work item]. This involves [brief description of work].

---

## Features (Done)

<!-- 
  WORK ITEM TYPE: Features
  
  List completed features and major accomplishments.
  Use checkboxes to mark completed items if desired.
  Items in this section will be tagged as "Features" by the parser.
  The parser will identify TODO items (- [ ] and - [x]) throughout the document.
-->

- [x] Feature 1 - Completed and working
- [x] Feature 2 - Completed and working
- [x] Feature 3 - Completed and working

### Detailed Completed Features

#### Feature 1
- Description of what was implemented
- Key technical details
- Status: Production ready

---

## Features (In Progress)

<!-- 
  WORK ITEM TYPE: Features
  
  List features currently being developed.
  Include estimated completion or progress indicators if helpful.
  Items in this section will be tagged as "Features" by the parser.
-->

- [ ] Feature 4 - In active development (60% complete)
- [ ] Feature 5 - Just started

### Detailed In-Progress Features

#### Feature 4
- Current status: [description]
- Remaining work: [what's left to do]
- Estimated completion: [timeline]

---

## Enhancements

<!-- 
  WORK ITEM TYPE: Enhancements
  
  List improvements and enhancements to existing features.
  These are not new features, but improvements to what already exists.
  Items in this section will be tagged as "Enhancements" by the parser.
-->

- [ ] Enhancement 1 - Improve performance of Feature X
- [ ] Enhancement 2 - Add better error handling
- [ ] Enhancement 3 - Refactor for maintainability

### High Priority Enhancements

- Enhancement 1: [detailed description]
- Enhancement 2: [detailed description]

### Medium Priority Enhancements

- Enhancement 3: [detailed description]

---

## Known Issues

<!-- 
  WORK ITEM TYPE: Bugs
  
  Document bugs, problems, or issues that need to be addressed.
  Include severity, affected areas, and workarounds if available.
  Items in this section will be tagged as "Bugs" by the parser.
  
  Alternative section headings: "Active Bugs", "Outstanding Issues", "Bugs"
-->

### Active Bugs

- [ ] Bug 1 - [description] (High Priority)
- [ ] Bug 2 - [description] (Medium Priority)

### Bug Details

#### Bug 1
- **Description**: [what's wrong]
- **Severity**: High/Medium/Low
- **Affected Areas**: [where it occurs]
- **Steps to Reproduce**: [if known]
- **Workaround**: [if available]

---

## Outstanding Tasks

<!-- 
  WORK ITEM TYPE: Tasks
  
  Inbox for uncategorized work items that may later become features or enhancements.
  Can be organized by priority, category, or timeline.
  Items in this section will be tagged as "Tasks" by the parser.
  
  Alternative section headings: "Tasks", "Outstanding Tasks", "Todo"
-->

### High Priority

- [ ] Task 1 - [description]
- [ ] Task 2 - [description]

### Medium Priority

- [ ] Task 3 - [description]
- [ ] Task 4 - [description]

### Low Priority / Future

- [ ] Task 5 - [description]
- [ ] Task 6 - [description]

---

## Project Status

<!-- 
  Optional section for project health indicators.
  Can include metrics, completion percentages, or status summaries.
-->

**Overall Status**: Active Development  
**Completion**: ~75%  
**Last Major Update**: January 2025

### Metrics

- **Code Coverage**: 80%
- **Open Issues**: 5
- **Active Features**: 3
- **Completed Features**: 12

---

## Next Steps

<!-- 
  Outline immediate next actions and priorities.
  Helps track what should be worked on next.
-->

### Immediate (Next 1-2 weeks)

1. Fix Bug 1 (critical)
2. Complete Feature 4
3. Update documentation

### Short-term (Next 1-3 months)

1. Implement Enhancement 1
2. Add comprehensive testing
3. Performance optimization

### Long-term (3+ months)

1. Major refactoring
2. New feature development
3. Platform migration

---

## Notes

<!-- 
  Additional notes, decisions, or context that doesn't fit elsewhere.
  Can include architecture decisions, lessons learned, or future considerations.
-->

- Architecture decision: [explanation]
- Important note: [context]
- Future consideration: [idea]

---

<!-- 
  END OF TEMPLATE
  
  This template demonstrates the structure expected by Project Atlas.
  
  Key points:
  1. Manifest block MUST be at the top with valid JSON
  2. Four work item types are defined: Features, Enhancements, Bugs, Tasks
  3. Items are tagged by the section they appear in (no inference needed)
  4. TODO items use - [ ] (incomplete) and - [x] (completed) format
  5. Follow this structure when creating or regenerating project files
  
  Work Item Types:
  - Features: New functionality (sections like "Features (Done)", "Features (In Progress)")
  - Enhancements: Improvements to existing features (section: "Enhancements")
  - Bugs: Problems to fix (sections like "Known Issues", "Active Bugs")
  - Tasks: Inbox for uncategorized work (section: "Outstanding Tasks")
  
  The parser will:
  - Extract the manifest block and validate it
  - Parse markdown sections and extract work items
  - Tag items with their type based on section headings
  - Identify TODO items (- [ ] and - [x]) across all sections
  - Preserve markdown structure (lists, paragraphs, etc.)
-->

