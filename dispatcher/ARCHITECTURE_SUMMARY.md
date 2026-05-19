# Dispatcher 3-Layer Architecture — Final Summary

> 2026-05-17 | khmo + Claw 설계/구현 세션 최종 정리

## Overview
AI 에이전트 오케스트레이션 시스템 (dispatcher system)의 3-Layer 아키텍처.
khmo의 "capability-aware execution OS" 비전의 70-80% 달성.

## Core Flow
```
input → parser → matcher → [planner?] → execute → [escalation?] → reflection
```

## 3 Layers (단일 책임 원칙)

| Layer | Role | Must NOT do |
|-------|------|-------------|
| **planner** | task graph decomposition | agent 선택 ❌ |
| **dispatcher** | intent → policy → agent routing | task 분해 ❌ |
| **escalation** | failure recovery + report | planner 재호출 ❌ |
| **reflection** | post-hoc recording + analysis | 실행 경로 영향 ❌ |

## Absolute Rule (2026-05-17)
🔒 **"planner는 결정을 내리지 않는다"** — only outputs a graph of what to do, never who does it or how.

## File Structure
```
dispatcher/
├── dispatcher.js         # main engine (3-layer integrated)
├── policy.json           # 9 routing policies
├── registry.json          # 4 agents (hermes, metagpt, ejclaw, tradingagent)
├── lib/
│   ├── parser.js         # intent classification (rule + LLM hybrid)
│   ├── matcher.js        # policy matching (priority-based)
│   ├── executor.js       # agent invocation (HTTP / docker_exec)
│   ├── fallback.js       # agent fallback strategies
│   ├── circuit.js        # circuit breaker
│   ├── retry.js          # retry with backoff
│   ├── dedupe.js         # duplicate request prevention
│   ├── validator.js      # config validation
│   ├── observability.js  # logging + tracing
│   ├── planner.js [NEW]  # conditional task decomposition
│   ├── escalation.js [NEW] # escalation + repo search
│   ├── repo_search.js [NEW] # GitHub repo search via API
│   └── reflection.js [NEW] # execution recording + quality analysis
├── reflections/ [NEW]     # execution logs, patterns, suggestions
└── test/
    └── dispatcher.test.js
```

## Quality Score (Reflection bias prevention)
- Base: success 1.0 / failure 0.0
- Fallback penalty: -0.3 (lucky success)
- Duration penalty: -0.1~-0.2 (slow execution)
- Agent mismatch penalty: -0.2 (wrong agent used)
- Low latency bonus: +0.1
- Escalation penalty: -0.1

## CLI
```
--dispatch "<msg>"    # main execution
--status              # system status
--logs                # recent logs
--reflection          # execution summary with quality
--suggestions         # policy improvement suggestions
--test-escalation     # escalation test
--test-planner [msg]  # planner test
--registry-check      # health check
```
