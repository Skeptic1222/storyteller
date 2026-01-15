# Storyteller - CLAUDE.md

## PROJECT IDENTITY - READ THIS FIRST

> **YOU ARE WORKING ON: Storyteller**
> **PROJECT PATH: C:\inetpub\wwwroot\storyteller**
> **ALLOWED DIRECTORY: C:\inetpub\wwwroot\storyteller and subdirectories ONLY**

### Session Info
- **Ports:** 5100
- **Status:** ACTIVE
- **Service:** StorytellerService (NSSM)

---

## CRITICAL RULES (Always Follow)

1. **STAY IN YOUR LANE**: ONLY modify files within C:\inetpub\wwwroot\storyteller
2. **VERIFY PATHS**: Before editing ANY file, confirm its path starts with C:\inetpub\wwwroot\storyteller
3. **NO CROSS-PROJECT EDITS**: If a file is outside this directory, ASK the user first
4. **CHECK SITELIST**: Before killing ports/processes, read C:\inetpub\wwwroot\sitelist.txt

---

## AFTER COMPACTING - DO THIS IMMEDIATELY

When the conversation is compacted, you lose context. **Immediately do these checks:**

1. **Read your session file:** Read .claude-session
2. **Confirm your project:** You should be working on **Storyteller** at **C:\inetpub\wwwroot\storyteller**
3. **If asked about other projects:** Say "This is the Storyteller session. Should I switch focus?"

---

## Recent Performance Optimizations (2025-12-25)

The following performance improvements were implemented:

### Database Optimizations
- **Migration 023**: Critical composite indexes for library listing, story bible lookups, recording segments
- Run pending: `psql -d storyteller_db -f database/migrations/023_critical_performance_indexes.sql`

### Server-Side Fixes
- **library.js**: Fixed N+1 queries using CTEs, parallelized independent queries with Promise.all
- **library.js**: Added cache-aside pattern for library list and story details (60s-5min TTL)
- **pool.js**: Added connection pool monitoring with stats and warning thresholds
- **recording.js**: Converted sync file I/O to async (writeFile, readFile, unlink)

### Client-Side Fixes
- **AudioContext.jsx**: Memory leak prevention with MAX_QUEUE_SIZE (10) and MAX_BLOB_URLS (50)
- Queue drops oldest items when full, aggressive blob URL cleanup when limit reached

### Documentation
- Full implementation details in `PERFORMANCE_OPTIMIZATION_IMPLEMENTATION.md`

---

## Coordination

All Claude Code instances coordinate via: C:\inetpub\wwwroot\sitelist.txt
