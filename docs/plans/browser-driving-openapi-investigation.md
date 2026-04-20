# Browser Driving And OpenAPI Investigation

## Summary

This is a side investigation that may later turn into tooling. Its purpose is to evaluate browser-driving systems that operate against a real authenticated browser and determine whether they can be converted into dependable OpenAPI-compatible endpoints for navigation, extraction, and orchestration.

This is not the primary v1 runtime path. The primary v1 path remains:

- browser extension for in-page capture and injection
- local daemon for normalization, archive writes, Mem0, and MCP

## Why investigate this

Browser-driving tools are still strategically useful for:

- authenticated navigation and recovery flows
- scripted account- or thread-level backfill
- smoke testing provider adapters in a real browser
- fallback extraction when content scripts cannot reliably observe a flow
- future agent workflows that need browser interaction without directly coupling product logic to a specific LLM-driven browser framework

## Core principle

We do not want to depend on a browser-driving tool's native LLM runtime as the product interface.

We want to evaluate whether these tools can instead be exposed as OpenAPI-compatible endpoints so they become normal infrastructure:

- deterministic browser actions
- deterministic extraction endpoints
- composable orchestration behind a stable API boundary

## Investigation targets

Evaluate at least:

- Anchor Browser
- browser-use / browser-based style tooling
- Steel or similar browser CLI / remote browser tooling
- any adjacent browser-driving tools already present in the user's stack

## Questions to answer

### Feasibility

- Can the tool attach to and operate a real logged-in browser/profile?
- Can it preserve credentials in the user's actual browser context?
- Can it navigate and extract from anti-bot / anti-agent protected LLM websites reliably enough to be useful?

### API suitability

- Can the tool be wrapped cleanly behind OpenAPI-compatible endpoints?
- Can it expose deterministic primitives like:
  - open tab
  - navigate
  - wait for selector
  - extract DOM fragment
  - run JS in page
  - capture network payload
- Can those primitives be made stable enough that our local daemon can call them without inheriting a brittle agent loop?

### Product fit

- Is it better used for:
  - operator tooling
  - automated testing
  - backfill/import
  - fallback extraction
  - full runtime provider capture
- Which parts complement the extension, and which parts would duplicate it badly?

## Expected output

This investigation should produce:

- a comparison matrix across candidate tools
- a recommendation on whether any should be wrapped as internal OpenAPI services
- a decision on whether this remains a side tool, becomes a testing harness, or graduates into first-class platform infrastructure

## Decision bias

The default assumption should be:

- browser-driving tools are complements, not replacements, for the extension-based capture edge in v1
- if adopted, they should be normalized behind OpenAPI-compatible endpoints rather than coupled directly to a specific agent product
