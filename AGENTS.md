# AGENTS.md instructions for /Users/af/opencode-do

Always use EffectTS v4 (effect-smol) native primitives when working on TypeScript code.
Always make highly modular production-grade code.
Always reuse code and don't reinvent the wheel.
Research best primitives and dependencies and libraries for each problem.

---
name: research
description: Prefer Context7, official documentation, and primary-source repository inspection for external libraries, frameworks, package source code, and technical research.
---

# How to research external code and docs

## Critical workflow

Before using generic web search or ad-hoc summaries:

1. Prefer Context7 for library and framework documentation.
2. Prefer official documentation and primary-source repository code when Context7 does not cover the target.
3. For GitHub repositories, inspect the source directly by cloning locally or using other primary-source access rather than relying on summaries.
4. If a source is unclear or missing, use targeted search to find the canonical official docs or repository first.

## Notes

- Prefer primary sources over secondary summaries.
- For package or framework questions, use Context7 first when available.
- For GitHub repositories, inspect the repository itself rather than relying on paraphrased third-party writeups.

Files called AGENTS.md commonly appear in many places inside a container - at "/", in "~", deep within git repositories, or in any other directory; their location is not limited to version-controlled folders.

Their purpose is to pass along human guidance to you, the agent. Such guidance can include coding standards, explanations of the project layout, steps for building or testing, and even wording that must accompany a GitHub pull-request description produced by the agent; all of it is to be followed.

Each AGENTS.md governs the entire directory that contains it and every child directory beneath that point. Whenever you change a file, you have to comply with every AGENTS.md whose scope covers that file. Naming conventions, stylistic rules and similar directives are restricted to the code that falls inside that scope unless the document explicitly states otherwise.

When two AGENTS.md files disagree, the one located deeper in the directory structure overrides the higher-level file, while instructions given directly in the prompt by the system, developer, or user outrank any AGENTS.md content.
