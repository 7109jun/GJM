# Godot-J-MCP (GJM) 7.0.0

Godot-J-MCP (GJM) is an AI-first Godot MCP server. It exposes MCP tools over stdio for project creation, editing, runtime control, testing, diagnostics, rollback, assets, templates, intelligence, orchestration, and release workflows.

## 6.0

GJM 6.0 adds `gjm_scene_operations`, an engine-backed API for creating scenes and adding, removing, renaming, reparenting, duplicating, editing, and scripting arbitrary Godot nodes.

The validation layer also detects key Godot parser/resource diagnostics even when Godot 3 reports process exit code 0.

See `docs/GJM-6.0-SCENE-OPS.md` for examples.


## Historical 6.1 Studio automation

GJM 7.0 retains and extends the 6.2 stack: it can create procedural 3D models, rig definitions, AnimationPlayer clips, shaders, WAV/MP3 assets, InputMap actions and ENet/WebSocket networking scaffolds. It also provides autonomous replay tests, background jobs and bounded parallel execution. See `docs/GJM-6.1-STUDIO.md` and `examples/studio.gjm.json`.


## Historical 6.2 Studio

GJM 7.0 can create animation clips, procedural 3D models, rig definitions, shaders, WAV/MP3 assets, InputMap actions and ENet/WebSocket scaffolds. `gjm_autoplay`, background jobs and bounded parallel execution are included. See `docs/GJM-6.1-STUDIO.md` and `examples/studio.gjm.json`.

## 7.0 Power Layer

GJM 7.0 adds project intelligence/auditing, dependency-free procedural PNG generation, animation keyframe editing, runtime shader validation, profile regression comparison, deterministic gameplay fuzzing, InputMap auditing, and release readiness gates.
