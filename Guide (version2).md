# GJM 7.0.0 — Complete AI Tutorial and Operating Manual

## Purpose of this document

This document is the authoritative, AI-oriented operating tutorial for **Godot-J-MCP (GJM) 7.0.0**.

It is written so that an AI agent can understand how to use GJM as a full Godot engineering interface rather than treating it as a collection of isolated helper commands.

The central idea is:

> **GJM is an AI-first automation layer for Godot. The AI decides what the project should become; GJM performs bounded, machine-readable, verifiable operations; Godot is used as the actual engine/runtime when engine-backed behavior is required.**

This document explains:

- what GJM is and is not;
- how the MCP transport works;
- how an AI should reason about a Godot project before modifying it;
- every major GJM tool family;
- all 78 exposed MCP tools;
- the declarative `godot.make.json` format;
- the runtime `Behavior.json` format;
- scenes, scripts, assets, models, rigs, animation, shaders, audio, input, networking, profiling, fuzzing, jobs, parallel execution, transactions, snapshots, diagnosis, repair, release gates, and export;
- how to use the universal operation interface;
- how to recover from errors without destroying valid work;
- how to verify every meaningful change;
- how to structure prompts so an AI can complete a whole game-development task end-to-end.

The examples are intentionally explicit. An AI should prefer structured, observable operations over guessing.

---

# 1. Mental model: what GJM actually does

Think about GJM as five cooperating layers.

```text
AI / MCP Client
      |
      v
+---------------------------+
| GJM MCP interface         |
| 78 tools + resources      |
| native stdio MCP          |
+-------------+-------------+
              |
              v
+---------------------------+
| GJM orchestration         |
| plans / universal ops     |
| sessions / transactions   |
| snapshots / jobs /        |
| parallel execution        |
+-------------+-------------+
              |
              v
+---------------------------+
| Project operations        |
| files / scenes / scripts  |
| settings / assets / Git   |
+-------------+-------------+
              |
              v
+---------------------------+
| Godot + runtime           |
| validation / execution    |
| runtime tree / gameplay   |
| profiling / networking   |
+-------------+-------------+
              |
              v
+---------------------------+
| Evidence                  |
| JSON results / artifacts  |
| screenshots / MP4         |
| diagnostics / regression  |
+---------------------------+
```

The most important principle is **closed-loop engineering**:

```text
Understand -> Change -> Validate -> Run -> Observe -> Diagnose -> Repair -> Revalidate
```

For destructive or uncertain edits, add a transaction or snapshot:

```text
Snapshot -> Change -> Validate -> Test -> Keep OR Restore
```

For large independent work:

```text
Decompose -> Parallelize independent jobs -> Join -> Validate integrated result
```

For long work:

```text
Start job -> Poll status -> Inspect artifacts -> Continue/repair -> Finish
```

Never assume that a file edit means the game is correct. A correct AI workflow treats **verification as part of the change**.

---

# 2. What GJM is designed to let an AI do

GJM 7.0.0 exposes capabilities across these domains:

- project creation and modification;
- file and directory operations;
- scripted Godot tasks;
- declarative project plans;
- declarative gameplay tests;
- scene creation and node manipulation;
- script patching;
- raw scene patching;
- project settings;
- templates;
- assets and asset import;
- runtime bridge and live scene-tree inspection;
- assertions;
- screenshots and recorded frames;
- MP4 export;
- AI diagnosis and repair;
- rollback snapshots;
- sessions for bounded self-healing;
- project indexing and context packing;
- dependency-graph analysis;
- deep project audit;
- procedural models;
- rigs and bone hierarchies;
- AnimationPlayer clip generation;
- animation keyframe editing;
- shaders;
- shader validation;
- audio import;
- procedural WAV generation;
- procedural SVG generation;
- procedural PNG texture generation;
- InputMap actions;
- InputMap auditing;
- ENet networking scaffolding;
- WebSocket networking scaffolding;
- network smoke tests;
- automatic gameplay replay;
- deterministic gameplay fuzzing;
- runtime profiling;
- profile comparison;
- editor plugin generation;
- background jobs;
- bounded parallel operations;
- studio-level bundled generation;
- release readiness gates;
- release packaging and export matrices;
- Git integration.

The important limitation is also important: GJM automates the Godot project and invokes the installed Godot runtime, but it does not magically replace engine-specific design knowledge. The AI still has to decide what should be built and interpret the resulting evidence.

---

# 3. Installation and runtime requirements

## 3.1 Node.js

GJM 7.0.0 requires:

```text
Node.js >= 20
```

The package has no runtime npm dependencies:

```json
"dependencies": {}
```

TypeScript is used as a development dependency for compilation.

Build:

```bash
npm install
npm run build
```

Start:

```bash
npm start
```

The package entry point is:

```text
dist/src/index.js
```

The executable alias is:

```text
gjm
```

---

## 3.2 Godot

GJM invokes the installed Godot executable for engine-backed operations.

Do not assume the same Godot major version for every installation. Some GJM helpers are explicitly version-aware, and some of the current studio networking scaffolds are designed around Godot 3.x behavior.

The AI should first inspect the environment when the tool is available:

```text
gjm_doctor
```

and/or:

```text
gjm_environment
```

These are preferable to guessing whether Node.js, Godot, FFmpeg, or supporting executables exist.

---

## 3.3 FFmpeg

MP4 export is implemented through FFmpeg. The AI should not claim that video export succeeded unless GJM returns a successful result from `gjm_export_mp4` or a pipeline that includes it.

---

# 4. MCP transport and how an AI should connect

GJM exposes MCP over **stdio**.

Conceptually:

```text
AI client
  <stdin/stdout>
      |
      v
node dist/src/index.js
      |
      v
GJM server
```

A compliant client should perform the normal MCP lifecycle instead of assuming tools are available without discovery.

Recommended discovery sequence:

```text
1. initialize
2. inspect server metadata
3. tools/list
4. resources/list
5. prompts/list
6. select the smallest tool set that can satisfy the task
```

Use `gjm_server_info` and `gjm_capabilities` after connection when you need application-level capability information.

Do not hard-code assumptions about future tool counts. Tool names and schemas are the authority exposed by the running server.

---

# 5. The Golden AI Workflow

For almost every non-trivial task, use this sequence.

## Phase A — Understand

1. Determine the target `projectRoot`.
2. Run environment checks if the environment is unknown.
3. Build project context.
4. Build the project index for structural understanding.
5. Build a dependency graph when the task crosses scenes/scripts/resources.
6. Audit the project when the task may be affected by existing structural issues.

Typical tools:

```text
gjm_environment
gjm_doctor
gjm_context
gjm_context_pack
gjm_project_index
gjm_dependency_graph
gjm_audit
```

## Phase B — Protect

Before risky edits:

```text
gjm_snapshot_create
```

For multi-step changes that should behave atomically, prefer:

```text
gjm_transaction
```

A transaction creates a pre-change snapshot and restores it automatically when the transaction fails.

## Phase C — Change

Choose the appropriate abstraction level.

Use declarative plans for repeatable multi-file project creation.

Use scene operations for engine-backed node editing.

Use script patching for targeted source edits.

Use studio or specialist tools for generated assets and high-level domains.

Use `gjm_do_anything` or `gjm_universal` when the AI needs to combine many operation types in one controlled request.

## Phase D — Validate

After changes:

```text
gjm_make_validate        # when using godot.make.json
gjm_validate             # project-level Godot validation
gjm_shader_validate      # shader-specific validation
gjm_input_audit          # requested InputMap actions
gjm_release_readiness    # final health gate
```

## Phase E — Run and observe

Use:

```text
gjm_run
gjm_runtime_start
gjm_runtime_inspect
gjm_runtime_tree
```

Use `gjm_godot_script` for a custom engine-backed observation task when no dedicated tool is a better fit.

## Phase F — Test

Use:

```text
gjm_behavior_validate
gjm_run_behavior
gjm_autoplay
gjm_autoplay_fuzz
```

Capture artifacts and assertions.

## Phase G — Diagnose and repair

When something fails:

```text
gjm_read_result
gjm_diagnose
gjm_prepare_fix
gjm_apply_fix
```

For longer bounded self-healing workflows:

```text
gjm_session_start
gjm_next
...
gjm_session_update
gjm_session_stop
```

## Phase H — Re-test

A repair is not complete until the original failure path is tested again.

## Phase I — Release

Before claiming completion:

```text
gjm_release_readiness
gjm_release
```

For reproducibility, prefer a generated release package/manifest and keep evidence of validation and tests.

---

# 6. The 78 MCP tools — complete reference

This section lists every exposed MCP tool in GJM 7.0.0.

## 6.1 Session and self-healing tools

### `gjm_session_start`

Start a bounded repair/test session.

Arguments:

```json
{
  "projectRoot": "C:/project",
  "maxAttempts": 5
}
```

Use when the AI should iteratively inspect, repair, validate, and stop after a bounded number of correction attempts.

### `gjm_session_status`

Read current session state.

```json
{
  "projectRoot": "C:/project"
}
```

### `gjm_next`

Ask GJM for the next recommended session action based on current state and recent results.

### `gjm_session_stop`

Stop a session.

Possible status values:

```text
completed
failed
stopped
```

---

## 6.2 Rollback / safety tools

### `gjm_snapshot_create`

Create a rollback snapshot.

```json
{
  "projectRoot": "C:/project",
  "label": "before-player-controller"
}
```

### `gjm_snapshot_list`

List snapshots for a project.

### `gjm_snapshot_restore`

Restore a snapshot by ID.

### `gjm_snapshot_delete`

Delete a snapshot by ID.

AI rule: snapshot before destructive edits when recovery cost is significant.

---

## 6.3 Environment tools

### `gjm_doctor`

Run environment diagnostics for Node.js, Godot, FFmpeg, and runtime availability.

Arguments: `{}`

### `gjm_environment`

Return GJM runtime environment/tool availability.

Arguments: `{}`

---

## 6.4 Runtime inspection tools

### `gjm_runtime_inspect`

Inspect the currently running GJM runtime.

Includes structured information such as engine version, scene, node count, and process state.

### `gjm_runtime_tree`

Read a live scene-tree branch without intentionally changing runtime state.

Example:

```json
{
  "projectRoot": "C:/project",
  "path": "."
}
```

The `path` can target a subtree instead of the entire tree.

---

## 6.5 Context / understanding tools

### `gjm_context_pack`

Build a compact machine-readable bundle containing project context, project index, dependency graph, recent result/session state, and selected text files.

Useful for an AI with a limited context window.

Important options:

```json
{
  "projectRoot": "C:/project",
  "includeFiles": true,
  "includeContent": false,
  "maxFiles": 300
}
```

### `gjm_context`

Collect a bounded project snapshot including project, environment, session, runtime, result, snapshots, artifacts, and workspace metadata.

### `gjm_project_index`

Build a structural index of:

- scenes;
- scripts;
- shaders;
- resources;
- nodes;
- classes;
- functions.

Use `includeSource` only when source content is genuinely needed, because source inclusion increases context size.

### `gjm_dependency_graph`

Analyze project-local dependency relationships among scripts, scenes, shaders, and resources.

### `gjm_audit`

Perform a deeper static project audit covering files, scenes, scripts, markers, and structural issues.

AI recommendation:

```text
context -> index -> dependency graph -> audit
```

when working on an unfamiliar project.

---

## 6.6 MCP metadata

### `gjm_server_info`

Return protocol-facing server metadata, capabilities, supported formats, and workflow entry points.

### `gjm_capabilities`

Return the high-level capability map and operation aliases.

These are useful when an AI must decide which abstraction exists before inventing a custom workaround.

---

# 7. Declarative project creation: `godot.make.json`

`godot.make.json` is the main declarative project-building format.

Minimal structure:

```json
{
  "format": "godot.make",
  "version": 1,
  "name": "My Game",
  "description": "A small Godot game",
  "actions": []
}
```

The schema requires:

- `format` equal to `godot.make`;
- integer `version`;
- an `actions` array.

Supported action types include:

```text
directory
file
script
shader
resource
asset_base64
copy
project_setting
input_action
autoload
template
scene
scene_raw
feature
godot_script
```

The exact options depend on the action type. An AI should treat the schema and live server implementation as authoritative rather than assuming every action has identical fields.

---

## 7.1 `gjm_import_json`

Import inline JSON content or a local uploaded file.

Use this when the AI receives a generated `godot.make.json` or `Behavior.json` as data rather than already-existing project state.

---

## 7.2 `gjm_make_validate`

Validate a `godot.make.json` without modifying the project.

Example:

```json
{
  "projectRoot": "C:/project",
  "content": "{\"format\":\"godot.make\",\"version\":1,\"actions\":[]}"
}
```

Prefer validation before apply.

---

## 7.3 `gjm_make_apply`

Apply `godot.make.json`.

Important option:

```json
"dryRun": true
```

Use dry-run when evaluating an unfamiliar plan or when an AI needs to preview the operation before changing the project.

---

# 8. Direct project validation, execution, and pipelines

## `gjm_validate`

Run Godot validation in headless mode and return structured GJM errors.

Do not confuse process exit code with total correctness. GJM validation is designed to capture relevant parser/resource issues even in situations where the Godot process itself exits successfully.

## `gjm_run`

Run the project or a specific scene.

Example:

```json
{
  "projectRoot": "C:/project",
  "scene": "res://Main.tscn",
  "timeoutMs": 30000
}
```

## `gjm_execute`

Execute a higher-level GJM workflow using make/behavior input, snapshots, and bounded correction attempts.

Typical conceptual flow:

```text
godot.make -> apply -> validate -> Behavior -> run -> collect result
```

## `gjm_pipeline`

Execute the main GJM end-to-end pipeline. Make and Behavior can be supplied from a path or inline JSON.

Use this when the task is explicitly an end-to-end build-and-test workflow.

---

# 9. Gameplay testing with `Behavior.json`

`Behavior.json` describes automated runtime behavior and assertions.

Minimal structure:

```json
{
  "format": "godot.behavior",
  "version": 1,
  "actions": [],
  "assertions": [],
  "capture": {}
}
```

The schema explicitly requires:

- `format = godot.behavior`;
- integer `version`;
- `actions`.

The AI should keep gameplay tests deterministic whenever possible.

---

## `gjm_behavior_validate`

Validate the behavior definition before execution.

## `gjm_run_behavior`

Execute the behavior runner and capture PNG frames.

## `gjm_export_mp4`

Convert captured frames into an H.264 MP4 through FFmpeg.

Example:

```json
{
  "projectRoot": "C:/project",
  "output": "evidence/gameplay.mp4",
  "fps": 30
}
```

## `gjm_autoplay`

Repeat a Behavior test multiple times and aggregate:

- assertions;
- frames;
- checkpoints;
- failures.

Example:

```json
{
  "projectRoot": "C:/project",
  "behavior": {
    "format": "godot.behavior",
    "version": 1,
    "actions": []
  },
  "runs": 5,
  "stopOnFailure": true
}
```

---

# 10. Deterministic gameplay fuzzing

## `gjm_autoplay_fuzz`

Generate deterministic randomized keyboard-input variants from a behavior specification and repeatedly execute them.

Important fields:

```text
runs
seed
behavior
```

Example:

```json
{
  "projectRoot": "C:/project",
  "behavior": {
    "format": "godot.behavior",
    "version": 1,
    "actions": []
  },
  "runs": 20,
  "seed": 12345
}
```

Why a seed matters:

```text
same project + same behavior + same seed
            -> reproducible generated input sequence
```

That makes failures easier to reproduce and repair.

AI rule: when fuzzing finds a failure, record the seed and convert the failing sequence into a stable regression test before claiming the issue is fixed.

---

# 11. Recording and artifacts

## `gjm_artifacts`

Collect GJM-generated artifacts for a project.

Use after runtime tests or pipelines when you need an evidence inventory.

## `gjm_read_result`

Read the last machine-readable GJM result.

## `gjm_record`

Record/control GJM run evidence through the dedicated recording subsystem.

When an AI says “the game works,” it should ideally have evidence such as:

```text
validation = pass
behavior assertions = pass
frames captured = yes
runtime observation = expected
```

---

# 12. Diagnostics and automatic repair

## `gjm_diagnose`

Diagnose the most recent failure using the last result and contextual evidence.

## `gjm_prepare_fix`

Prepare a targeted repair context. This gives the AI a bounded basis for deciding what to change.

## `gjm_apply_fix`

Apply a prepared repair, including make content when appropriate.

The intended repair loop is:

```text
FAIL
 |
v
read_result
 |
v
diagnose
 |
v
prepare_fix
 |
v
apply_fix
 |
v
validate
 |
v
test again
```

Avoid making unrelated changes while repairing a specific failure.

---

# 13. Workspace, project, and Git operations

## `gjm_workspace`

File-system-oriented project workspace operations.

Use for actions such as listing, reading, writing, searching, creating directories, copying, or deleting according to the operation accepted by the tool.

## `gjm_project`

Project-level operations such as information gathering, configuration-related actions, and project export-oriented operations exposed through the project action layer.

## `gjm_git`

Perform Git operations through GJM's Git abstraction.

AI safety rule:

- read status before mutating Git state;
- avoid destructive history operations unless explicitly requested;
- inspect generated files before committing;
- do not claim a remote push occurred without a successful tool result.

---

# 14. Assets and templates

## `gjm_assets`

List or inspect project assets through the asset subsystem.

## `gjm_template_list`

List available built-in templates/features.

## `gjm_template_apply`

Apply a template.

Templates are useful when the AI needs a known-good starting structure instead of constructing every file manually.

---

# 15. Scene editing — the engine-backed scene API

## `gjm_scene_operations`

This is one of the most important GJM tools for real Godot editing.

It can perform operations such as:

- create a scene;
- add nodes;
- remove nodes;
- rename nodes;
- reparent nodes;
- duplicate nodes;
- set properties;
- attach scripts;
- save scenes.

The scene operation engine is designed around actual Godot scene/resource behavior instead of treating `.tscn` as a blind text file.

Example conceptual operation array:

```json
[
  {
    "op": "create",
    "scene": "res://Main.tscn",
    "rootType": "Node",
    "rootName": "Main"
  },
  {
    "op": "add_node",
    "scene": "res://Main.tscn",
    "parent": ".",
    "type": "Node2D",
    "name": "World"
  },
  {
    "op": "add_node",
    "scene": "res://Main.tscn",
    "parent": ".",
    "type": "Camera2D",
    "name": "Camera"
  },
  {
    "op": "set_property",
    "scene": "res://Main.tscn",
    "path": "Camera",
    "property": "position",
    "value": {
      "vector2": [640, 360]
    }
  }
]
```

The exact property encodings accepted by the implementation should be learned from the tool schema and current runtime rather than guessed.

The implementation bounds a single scene-operation call to at most 100 scene operations.

---

# 16. Script editing

GJM supports both targeted edits and more advanced workflow operations.

## `gjm_godot_script`

Use this when an AI needs to execute a custom Godot script task and no dedicated higher-level operation is more appropriate.

Typical reasons:

- inspect a resource using Godot itself;
- perform a specialized engine-side conversion;
- query runtime data;
- execute an operation that is intentionally outside the standard helper set.

Treat this as an escape hatch, not as a reason to bypass safer typed tools.

## Script patch modes inside universal operations

The script patch layer supports:

```text
replace
append
prepend
insert_after
insert_before
line_replace
line_insert
line_delete
```

Example conceptual patch:

```json
{
  "op": "patch_script",
  "args": {
    "path": "scripts/player.gd",
    "mode": "replace",
    "from": "speed = 200",
    "to": "speed = 250"
  }
}
```

Line-based edits use **1-based line numbers**.

AI rule: prefer a narrow replacement marker or a clearly identified line over replacing an entire large script when only one behavior changes.

---

# 17. Raw `.tscn` scene patches

`patch_scene` supports narrow raw text edits for `.tscn` files.

Supported raw modes:

```text
raw_replace
raw_append
```

A `scene_patch` path must end in `.tscn`.

Use this only when structured scene operations cannot express the required resource-level edit.

AI rule:

```text
structured scene edit > targeted raw patch > complete file rewrite
```

unless the task specifically requires generating the whole scene text.

---

# 18. Project settings and input configuration

## `set_project_setting` via universal operations

The universal layer can set project settings.

Use this for settings such as:

- display size;
- rendering behavior;
- startup scene;
- custom project flags;
- engine configuration required by a generated feature.

Do not blindly overwrite the entire `project.godot` when only one setting is required.

---

# 19. Procedural 3D model generation

## `gjm_model`

GJM can generate small procedural OBJ models directly.

Supported primitive kinds include:

```text
cube
plane
pyramid
cylinder
uv_sphere
```

Example:

```json
{
  "projectRoot": "C:/project",
  "kind": "cube",
  "name": "crate",
  "output": "assets/models/crate.obj",
  "size": 2
}
```

Parameters can include:

```text
size
width
height
depth
```

The generated model is intended to be a dependency-free procedural asset rather than a replacement for a full DCC modeling application.

AI should use this for:

- primitives;
- blockouts;
- simple props;
- generated test meshes;
- deterministic geometry fixtures.

---

# 20. Rig generation

## `gjm_rig`

Create a reusable bone hierarchy and a runtime Skeleton builder.

Conceptual bone definition:

```json
{
  "name": "Root",
  "parent": "",
  "position": [0, 0, 0]
}
```

A complete rig normally contains a hierarchy such as:

```text
Root
└── Spine
    └── Chest
        ├── Head
        ├── Arm.L
        └── Arm.R
```

GJM's rig helper is designed to create the hierarchy and runtime builder representation. It should not be interpreted as a complete automatic skin-weighting system for arbitrary imported meshes.

For high-quality character production, the AI may combine:

```text
model generation
+ rig generation
+ animation generation
+ Godot runtime validation
```

---

# 21. Animation generation and editing

## `gjm_animation`

Create a reusable GJM animation clip manifest and runtime `AnimationPlayer` script.

Useful concepts:

```text
clip name
target node
property
tracks
keyframes
```

Example conceptual track:

```json
{
  "path": "Player:position",
  "keys": [
    { "time": 0, "value": { "vector2": [0, 0] } },
    { "time": 1, "value": { "vector2": [200, 0] } }
  ]
}
```

The exact target/property representation should match the generated manifest and live tool schema.

## `gjm_animation_edit`

Edit an existing GJM animation manifest.

Actions:

```text
add_key
remove_key
move_key
set_value
sort
```

Important arguments include:

```text
file
trackIndex
time
fromTime
value
property
```

A typical edit workflow is:

```text
create animation
 -> inspect manifest
 -> edit key
 -> sort
 -> run scene
 -> validate visual/runtime behavior
```

---

# 22. Shader generation and validation

## `gjm_shader`

Create a Godot shader source.

Shader types supported by the tool are:

```text
canvas_item
spatial
particles
```

The tool accepts optional uniforms and custom code.

## `gjm_shader_validate`

Use the actual installed Godot runtime to load/parse the shader source and return evidence.

Important arguments:

```text
shader
file
godotMajor
timeoutMs
```

This is better than purely textual shader checking because Godot itself decides whether the shader can be parsed/loaded.

AI rule:

```text
Generate shader -> validate shader -> attach to material -> run -> visually/runtime test
```

A shader that parses is not automatically visually correct. Shader validation proves a different property than gameplay correctness.

---

# 23. Audio

## `gjm_audio`

Import a WAV or MP3 into the Godot project.

The input can use:

```text
base64
source path
```

Example shape:

```json
{
  "projectRoot": "C:/project",
  "output": "audio/jump.wav",
  "source": "C:/assets/jump.wav"
}
```

## `gjm_generate_wav`

Generate a procedural PCM WAV tone directly, without external audio software.

Arguments include:

```text
seconds
frequency
sampleRate
amplitude
output
```

Example:

```json
{
  "projectRoot": "C:/project",
  "output": "audio/test_440.wav",
  "seconds": 1,
  "frequency": 440,
  "sampleRate": 44100,
  "amplitude": 0.2
}
```

Use procedural WAV generation for:

- test sounds;
- placeholder audio fixtures;
- deterministic audio experiments;
- generated beeps/UI sounds.

---

# 24. SVG generation

## `gjm_generate_svg`

Generate procedural SVG directly.

Common fields:

```text
width
height
background
foreground
text
output
```

Example:

```json
{
  "projectRoot": "C:/project",
  "output": "assets/ui/logo.svg",
  "width": 512,
  "height": 512,
  "background": "#202840",
  "foreground": "#ffffff",
  "text": "GJM"
}
```

Use SVG for deterministic UI graphics, icons, simple vector art, and generated test assets.

---

# 25. Procedural PNG texture generation

## `gjm_texture`

Generate PNG textures without an external image library.

Kinds:

```text
solid
gradient
checker
noise
```

Typical fields:

```text
width
height
color1
color2
seed
output
```

Example:

```json
{
  "projectRoot": "C:/project",
  "kind": "checker",
  "output": "assets/textures/checker.png",
  "width": 512,
  "height": 512,
  "color1": "#202020",
  "color2": "#808080"
}
```

A fixed seed should be preferred for deterministic noise textures used in tests or generated builds.

---

# 26. InputMap

## `gjm_input`

Create or update a Godot InputMap action.

Fields include:

```text
action
deadzone
events
```

Conceptual example:

```json
{
  "projectRoot": "C:/project",
  "action": "move_left",
  "deadzone": 0.5,
  "events": [
    { "type": "key", "keycode": 65 }
  ]
}
```

The exact event object schema should be learned from the live tool schema and target Godot version.

## `gjm_input_audit`

Check that requested action names exist in `project.godot`.

Example:

```json
{
  "projectRoot": "C:/project",
  "actions": ["move_left", "move_right", "jump"]
}
```

Use this immediately after input configuration when an AI needs evidence that the action names were actually created.

---

# 27. Networking

## `gjm_network`

Generate a Godot 3.x networking scaffold for:

```text
enet
websocket
```

Typical parameters:

```text
mode
outputDir
port
maxClients
```

This is a scaffold generator, not a guarantee that a complete multiplayer game has been designed.

## `gjm_network_test`

Start a short loopback network server inside Godot and verify initialization/binding.

Modes:

```text
enet
websocket
```

This proves that the selected network stack can initialize/bind in the tested environment.

It does **not** by itself prove:

- multi-machine connectivity;
- NAT traversal;
- production authentication;
- anti-cheat correctness;
- gameplay synchronization correctness.

For multiplayer, test progressively:

```text
bind test
 -> one server + one client
 -> message round-trip
 -> state synchronization
 -> disconnect/reconnect
 -> stress test
```

---

# 28. Runtime profiling

## `gjm_profile`

Run a bounded Godot profiling session.

Measures include information such as:

- FPS;
- frames;
- node count;
- processing-node count.

Typical arguments:

```text
seconds
output
godotBin
```

Example:

```json
{
  "projectRoot": "C:/project",
  "seconds": 10,
  "output": "reports/profile.json"
}
```

## `gjm_profile_compare`

Compare baseline/current profile JSON files and flag meaningful regressions in metrics such as:

- FPS;
- node count;
- processing workload.

Recommended workflow:

```text
profile baseline
 -> make change
 -> profile current
 -> compare
 -> decide whether regression is acceptable
```

Do not call a change “optimized” merely because it feels faster. Keep actual profile evidence.

---

# 29. Editor plugin generation

## `gjm_editor_plugin`

Generate a version-aware Godot `@tool`/`EditorPlugin` package with an editor toolbar action.

Useful fields include:

```text
name
outputDir
buttonText
godotBin
```

Use this when an AI needs to create project-local editor tooling, custom menu actions, or a reusable editor extension.

A generated editor plugin still needs to be enabled/loaded by Godot according to the target project's plugin configuration and engine version.

---

# 30. Studio operations

## `gjm_studio`

Run a bundled studio generation operation.

It can combine domains such as:

```text
animation
model
rig
shader
audio
input
networking
```

It can operate atomically with a snapshot.

Use this when the AI has a coherent asset/game feature bundle rather than unrelated one-off edits.

Conceptual spec:

```json
{
  "projectRoot": "C:/project",
  "spec": {
    "models": [ ... ],
    "animations": [ ... ],
    "rigs": [ ... ],
    "shaders": [ ... ],
    "audio": [ ... ],
    "inputs": [ ... ],
    "network": { ... }
  },
  "snapshot": true
}
```

The exact spec fields depend on the studio plan implementation. An AI must inspect the tool schema rather than invent unsupported keys.

## `gjm_studio_plan`

Run a potentially long studio generation plan as a background job.

Use this when asset generation may take long enough that blocking the MCP call is undesirable.

---

# 31. Background jobs

## `gjm_job_start`

Start a background job.

Supported job types include:

```text
validate
execute
autoplay
studio
```

Conceptual example:

```json
{
  "projectRoot": "C:/project",
  "type": "studio",
  "payload": { ... }
}
```

## `gjm_job_status`

Read one job.

```json
{
  "jobId": "..."
}
```

## `gjm_job_list`

List jobs, optionally filtered by `projectRoot`.

## `gjm_job_cancel`

Request cancellation of a job.

AI rule for long jobs:

```text
start
 -> do useful independent work
 -> poll status
 -> inspect result
 -> repair/retry if necessary
```

Do not blindly start many write-heavy jobs against the same files.

---

# 32. Parallel execution

## `gjm_parallel`

Execute independent GJM operations concurrently with a bounded concurrency limit.

Example shape:

```json
{
  "projectRoot": "C:/project",
  "jobs": [
    { "op": "model", "args": { ... } },
    { "op": "texture", "args": { ... } },
    { "op": "generate_wav", "args": { ... } }
  ],
  "maxConcurrency": 4
}
```

The key word is **independent**.

Good parallel tasks:

```text
create model A
create model B
create texture A
generate test audio
```

Bad parallel tasks:

```text
edit the same scene
edit the same script
change the same project.godot setting
run a test while another task mutates the project
```

The AI should build a dependency graph first when independence is not obvious.

---

# 33. The Universal Operation Interface

GJM exposes two especially important high-level interfaces:

```text
gjm_do_anything
gjm_universal
```

These exist so the AI can express a multi-step engineering task without having to make one MCP request for every tiny operation.

## Why universal operations matter

A full game task often looks like:

```text
create project
create scene
create player script
create input actions
create asset
attach script
validate
run
assert
record
```

A universal plan can represent that as one ordered operation set with failure behavior, conditions, interpolation, snapshots, and bounded concurrency.

---

# 34. Universal operation vocabulary

The main operation engine understands a broad operation vocabulary including:

```text
create_project
create_file
read_file
delete_file
create_directory
search_text
create_script
godot_script
scene_operations
patch_script
patch_scene
set_project_setting
create_template
run_game
test_game
record_video
inspect_runtime
runtime_tree
export_game
workspace
project
git
godot
make
validate
behavior
execute
runtime_start
runtime
runtime_status
runtime_stop
assets
assets_import
template
snapshot_create
snapshot_list
snapshot_restore
snapshot_delete
diagnose
prepare_fix
apply_fix
artifacts
read_result
doctor
environment
project_index
transaction
dependency_graph
release
import_json
script_patch
scene_patch
record
animation
model
rig
shader
audio
input
network
autoplay
studio
session_start
session_status
session_next
session_update
session_stop
audit
texture
animation_edit
profile_compare
shader_validate
autoplay_fuzz
input_audit
release_readiness
```

The live tool/schema is authoritative. If a future build adds or removes an alias, use the discovered server schema rather than this historical list.

---

# 35. Universal plan structure

A universal plan step conceptually looks like:

```json
{
  "op": "validate",
  "args": {},
  "id": "validate-main",
  "continueOnError": false,
  "retries": 0,
  "when": {}
}
```

A plan can have:

```text
ordered operations
step IDs
arguments
conditional execution
retries
continue-on-error behavior
rollback behavior
parallel limits
```

The top-level request can include:

```text
projectRoot
steps
snapshot
stopOnError
rollbackOnError
maxParallel
```

---

# 36. Interpolation and conditions

Universal operations support direct result interpolation in string values using this conceptual syntax:

```text
${some.path}
```

For example, if an earlier step returns:

```json
{
  "path": "res://generated/model.obj"
}
```

a later step may use a context reference to that returned field when supported by the operation's argument location.

Conditions support concepts including:

```text
and
or
not
exists
equals
notEquals
contains
truthy
```

This allows the AI to build decision-making workflows instead of always executing a fixed sequence.

---

# 37. Transactions

## `gjm_transaction`

Use a transaction when a set of modifications should be all-or-nothing.

Example concept:

```json
{
  "projectRoot": "C:/project",
  "steps": [
    {
      "op": "create_file",
      "args": {
        "path": "scripts/player.gd",
        "content": "..."
      }
    },
    {
      "op": "scene_operations",
      "args": {
        "operations": [ ... ]
      }
    },
    {
      "op": "validate",
      "args": {}
    }
  ],
  "keepSnapshot": false
}
```

On failure, the transaction layer restores the pre-change snapshot.

Use transaction semantics for:

- player-system refactors;
- scene restructuring;
- asset + script + scene changes that must remain consistent;
- risky large-scale generation.

Do not rely on transactions as a substitute for tests. A successfully committed transaction can still implement the wrong behavior.

---

# 38. Release workflow

## `gjm_release_readiness`

This is the final project health gate.

It checks a combination of project metadata, static issues, source-control presence, and total project size.

Use it before packaging.

## `gjm_release`

Operations:

```text
manifest
package
export_matrix
```

### Manifest

Produce a reproducible release manifest for the project.

### Package

Create a release package.

### Export matrix

Export multiple Godot presets into a release directory.

Arguments include:

```text
presets
mode = debug | release
timeoutMs
output
```

Release rule:

```text
readiness pass
 + validation pass
 + gameplay test pass
 + export pass
 = evidence-backed release candidate
```

---

# 39. `gjm_plan`

`gjm_plan` is an AI-facing planning entry point. Use it when the client needs a structured GJM plan before execution.

The preferred approach for complex tasks is:

```text
plan -> inspect -> execute -> verify
```

The AI should not generate a gigantic unverified plan merely because GJM can execute many operations. Plans should be bounded and observable.

---

# 40. How to build a complete small game with GJM

Here is a representative end-to-end workflow.

## Step 1 — Create or inspect the project

```text
gjm_doctor
gjm_environment
```

Then:

```text
gjm_context
gjm_project_index
```

## Step 2 — Protect the project

```text
gjm_snapshot_create
```

## Step 3 — Create declarative structure

Build a `godot.make.json` containing:

- project settings;
- directories;
- scripts;
- scenes;
- input actions;
- required resources.

Then:

```text
gjm_make_validate
gjm_make_apply
```

## Step 4 — Add scene nodes

Use `gjm_scene_operations` for structured scene work.

## Step 5 — Add generated assets

For example:

```text
gjm_model
gjm_texture
gjm_generate_svg
gjm_generate_wav
```

## Step 6 — Configure gameplay

```text
gjm_input
```

Then verify:

```text
gjm_input_audit
```

## Step 7 — Validate

```text
gjm_validate
```

## Step 8 — Run

```text
gjm_run
```

## Step 9 — Inspect runtime

```text
gjm_runtime_inspect
gjm_runtime_tree
```

## Step 10 — Test behavior

Create a `Behavior.json` and run:

```text
gjm_behavior_validate
gjm_run_behavior
gjm_export_mp4
```

## Step 11 — Repeat test runs

```text
gjm_autoplay
```

## Step 12 — Fuzz

```text
gjm_autoplay_fuzz
```

## Step 13 — Profile

```text
gjm_profile
```

## Step 14 — Fix failures

```text
gjm_read_result
gjm_diagnose
gjm_prepare_fix
```

Apply targeted changes and repeat validation.

## Step 15 — Release

```text
gjm_release_readiness
gjm_release
```

---

# 41. How an AI should reason about project changes

Before changing any file, classify the requested change.

## Category A — Pure text/file change

Examples:

- README;
- simple configuration;
- plain script line change.

Preferred tools:

```text
gjm_workspace
patch_script through universal operations
create_file/read_file
```

## Category B — Godot scene structure change

Examples:

- add camera;
- add UI node;
- reparent player;
- attach script.

Preferred tool:

```text
gjm_scene_operations
```

## Category C — Generated asset

Examples:

- cube OBJ;
- procedural PNG;
- SVG;
- WAV.

Preferred specialist tool:

```text
gjm_model
gjm_texture
gjm_generate_svg
gjm_generate_wav
```

## Category D — Runtime behavior

Examples:

- movement;
- shooting;
- UI interaction;
- scene transitions.

Preferred workflow:

```text
edit
 -> validate
 -> run
 -> behavior test
 -> inspect runtime
```

## Category E — Cross-cutting feature

Examples:

- multiplayer system;
- player + input + animations + scene setup;
- generated environment + gameplay + tests.

Preferred tool:

```text
gjm_do_anything
or
gjm_universal
or
gjm_studio
```

Use a transaction/snapshot when risk is significant.

---

# 42. Failure handling rules for AI agents

## Rule 1 — Never ignore a failed validation

A non-zero or structured error must trigger inspection.

## Rule 2 — Never repeatedly apply the same failed fix

Use the diagnostic result to change the hypothesis.

## Rule 3 — Separate root cause from symptoms

Example:

```text
symptom: player does not move
possible cause: InputMap action missing
possible cause: action name mismatch
possible cause: script not attached
possible cause: input event never reaches runtime
```

Do not immediately rewrite the controller.

## Rule 4 — Preserve working state

Use snapshots or transactions before risky changes.

## Rule 5 — Reproduce before repairing when possible

A failure with a deterministic Behavior or fuzz seed is easier to fix reliably.

## Rule 6 — Re-run the exact failing test after repair

A new test passing does not prove the original regression is gone.

---

# 43. AI self-healing pattern

The following pattern is recommended for autonomous repair.

```text
START
 |
v
SESSION_START(maxAttempts=5)
 |
v
CONTEXT
 |
v
VALIDATE / RUN / TEST
 |
 +---- PASS ----> COMPLETE
 |
 v
READ_RESULT
 |
v
DIAGNOSE
 |
v
PREPARE_FIX
 |
v
SNAPSHOT (if needed)
 |
v
APPLY_TARGETED_FIX
 |
v
VALIDATE AGAIN
 |
 +---- FAIL ----> NEXT ATTEMPT
 |
 +---- PASS ----> RUN REGRESSION TEST
 |
 +---- PASS ----> COMPLETE
```

Keep the correction loop bounded.

---

# 44. Context efficiency for large Godot projects

Large projects can exceed an AI context window if the agent reads every script in full.

Use a staged strategy.

### Stage 1 — structural view

```text
gjm_context
```

### Stage 2 — indexed view

```text
gjm_project_index
```

### Stage 3 — dependency view

```text
gjm_dependency_graph
```

### Stage 4 — focused source content

Use `includeSource` and selected file/content operations only where required.

### Stage 5 — packed evidence

```text
gjm_context_pack
```

An AI should minimize unnecessary source loading while retaining the information needed to make a correct change.

---

# 45. Recommended architecture for an AI-generated Godot game

A scalable generated project often separates:

```text
project.godot
scenes/
scripts/
assets/
assets/models/
assets/textures/
assets/audio/
assets/ui/
shaders/
animations/
rigs/
tests/
reports/
```

The exact layout is not required by GJM. It is a maintainability recommendation.

The AI should preserve stable naming conventions.

Example:

```text
Main.tscn
Player.tscn
Player.gd
Enemy.tscn
Enemy.gd
HUD.tscn
HUD.gd
```

Avoid renaming core project files casually because dependencies may exist outside the file being edited.

---

# 46. Suggested naming rules

Use:

```text
PascalCase for scenes/classes
snake_case for actions and script variables
```

Examples:

```text
Player.tscn
Player.gd
Main.tscn
move_left
move_right
jump
```

Asset names should communicate role rather than generation order.

Prefer:

```text
crate_small.obj
ui_panel.svg
player_jump.wav
stone_checker.png
```

over:

```text
asset1.obj
asset2.wav
thing_final_final.png
```

---

# 47. Performance-aware AI behavior

An AI should profile before and after significant optimization.

Bad approach:

```text
"This should be faster."
```

Better:

```text
baseline profile
 -> optimization
 -> current profile
 -> profile comparison
 -> verify gameplay still passes
```

Also consider node count and processing-node count, not FPS alone.

A higher FPS number obtained while breaking gameplay is not a successful optimization.

---

# 48. Networking-aware AI behavior

Do not declare a multiplayer system complete after generating a server/client scaffold.

The AI should distinguish these milestones:

```text
1. scaffold exists
2. server initializes
3. server binds port
4. client connects
5. messages round-trip
6. state synchronizes
7. disconnect/reconnect works
8. gameplay remains authoritative/correct
9. load testing passes
```

GJM's built-in network smoke testing is strongest at the initialization/bind stage; higher-level gameplay synchronization requires project-specific tests.

---

# 49. Shader-aware AI behavior

Use separate assertions for:

```text
shader parses
material loads
shader appears on target
visual output is correct
performance is acceptable
```

Do not collapse all five into one claim.

---

# 50. Animation-aware AI behavior

A complete animation feature typically needs:

```text
node target
animation clip
tracks
keyframes
runtime player
trigger logic
```

Generation alone does not guarantee the animation is triggered during gameplay.

The AI should test:

```text
animation exists
 -> clip loads
 -> player reaches target state
 -> expected property changes
```

---

# 51. Asset generation strategy

GJM can self-generate several useful asset classes.

Use:

```text
OBJ  -> simple 3D geometry
PNG  -> deterministic procedural textures
SVG  -> vector UI/art assets
WAV  -> deterministic test/generated audio
```

When the asset is generated, immediately verify file existence and, where practical, load it through Godot validation.

Generated assets should be deterministic whenever the result is used in tests, fixtures, or release reproducibility.

---

# 52. Parallelism strategy

Build a dependency DAG mentally or with `gjm_dependency_graph`.

Example:

```text
           +--> player model
start -----+--> UI texture
           +--> test audio
           |
           +--> input config
                  |
                  v
             player script
                  |
                  v
             main scene
                  |
                  v
               runtime
                  |
                  v
                tests
```

Everything before `player script` that is independent may be parallelized.

The scene should not be tested before required assets/scripts exist.

---

# 53. Background-job strategy

When work is long-running:

```text
job_start
   |
   +--> job_status
   +--> job_status
   +--> job_status
   |
   v
completed
```

When cancellation is necessary:

```text
job_cancel
 -> job_status
 -> confirm final state
```

The AI should not assume cancellation is instant. It should inspect the resulting status.

---

# 54. What GJM results mean

GJM returns machine-readable structured result objects.

At a high level, interpret results as:

```text
ok = true  -> requested operation completed according to GJM's contract
ok = false -> operation failed or could not be completed
```

Use result fields to determine:

- exact paths;
- generated artifact names;
- error messages;
- Godot stdout/stderr;
- assertions;
- counts;
- checkpoint data;
- profile data.

Do not infer missing fields.

---

# 55. Evidence hierarchy

When deciding whether a claim is proven, prefer evidence in this order:

```text
actual Godot runtime observation
> engine-backed validation
> GJM structured operation result
> static project/index inspection
> AI textual expectation
```

Example:

```text
"Player.tscn exists"          -> file/index evidence
"Player.tscn loads"           -> Godot validation
"Player moves"                -> runtime behavior test
"Player movement is smooth"   -> runtime observation/profile evidence
```

This distinction is essential for reliable autonomous agents.

---

# 56. Safe destructive-operation policy

Operations such as deletion, raw scene mutation, broad search/replace, or large generated rewrites can destroy valid project state.

Recommended rule:

```text
high-risk change
 -> snapshot/transaction
 -> execute
 -> validate
 -> regression test
```

For low-risk additive changes, a snapshot may not be necessary, but the AI should still know how to recover.

---

# 57. Example: complete AI task prompt

The following is a strong prompt pattern for an AI using GJM.

```text
You are the primary Godot engineer operating through GJM.

Project:
C:/Projects/MyGame

Objective:
Create a complete 2D action game prototype-quality production scene without leaving the project in a broken state.

Requirements:
1. Inspect the project before changing it.
2. Use GJM project indexing and dependency analysis before major edits.
3. Create a rollback snapshot before destructive work.
4. Build or modify scenes through structured scene operations where possible.
5. Generate required test assets through GJM where appropriate.
6. Configure InputMap actions and audit them.
7. Validate the project with Godot.
8. Run the game.
9. Inspect the runtime scene tree.
10. Create a Behavior.json test for the main gameplay loop.
11. Run the test and capture evidence.
12. Repeat the test several times.
13. Run deterministic fuzzing.
14. Diagnose and repair any failures automatically, but keep repairs bounded.
15. Re-run the original failing test after every repair.
16. Profile the project before release if the feature is performance-sensitive.
17. Run release readiness checks.
18. Produce a final machine-readable report containing:
    - files changed;
    - validation status;
    - test status;
    - assertion counts;
    - fuzz seed(s);
    - profile results when used;
    - artifacts;
    - release readiness;
    - any remaining limitations.

Do not claim success based only on generated files. Success requires validation and runtime evidence.
Do not make unrelated changes while fixing a failure.
Do not repeat a failed repair unchanged.
Use snapshots or transactions for risky operations.
```

---

# 58. Example: build a project through `gjm_do_anything`

Conceptual request:

```json
{
  "projectRoot": "C:/Projects/Demo",
  "snapshot": true,
  "stopOnError": true,
  "rollbackOnError": true,
  "steps": [
    {
      "id": "project",
      "op": "create_project",
      "args": {
        "name": "GJM Demo",
        "mainScene": "res://Main.tscn"
      }
    },
    {
      "id": "input-left",
      "op": "input",
      "args": {
        "action": "move_left"
      }
    },
    {
      "id": "scene",
      "op": "scene_operations",
      "args": {
        "operations": [
          {
            "op": "create",
            "scene": "res://Main.tscn",
            "rootType": "Node",
            "rootName": "Main"
          }
        ]
      }
    },
    {
      "id": "validate",
      "op": "validate"
    }
  ]
}
```

The important part is not the exact example values. The pattern is:

```text
ordered IDs
+ typed operation names
+ explicit arguments
+ stop/rollback policy
+ verification step
```

---

# 59. Example: create a generated asset bundle

A practical asset bundle can be generated as independent work:

```text
model = cube OBJ
texture = checker PNG
logo = SVG
sound = WAV
```

Then a dependent scene operation can reference those outputs.

Conceptual dependency order:

```text
[model, texture, logo, sound]
           |
           v
        scene setup
           |
           v
        validation
           |
           v
       runtime test
```

---

# 60. Example: autonomous bug repair

Suppose a gameplay assertion fails.

Do this:

```text
1. gjm_read_result
2. gjm_diagnose
3. inspect relevant script/scene
4. prepare a targeted fix
5. create snapshot if needed
6. apply fix
7. gjm_validate
8. rerun the failing Behavior
9. rerun the broader regression suite
10. inspect artifacts
```

Do not immediately rewrite the whole subsystem.

---

# 61. Common mistakes an AI must avoid

## Mistake: editing `.tscn` by blind string replacement

Prefer `gjm_scene_operations`.

## Mistake: claiming a game runs because a file exists

Use `gjm_run` and runtime evidence.

## Mistake: claiming multiplayer works because ENet/WebSocket initialized

Initialization is not gameplay synchronization.

## Mistake: claiming a shader is correct because it was generated

Run `gjm_shader_validate`, then test actual use.

## Mistake: claiming InputMap is correct because the script references an action name

Use `gjm_input_audit`.

## Mistake: optimizing without a baseline

Use `gjm_profile` and `gjm_profile_compare`.

## Mistake: treating fuzzing as random noise

Record the seed and convert discovered failures into deterministic regression cases.

## Mistake: running many parallel write operations on the same resource

Only parallelize independent operations.

## Mistake: making dozens of speculative edits before validating

Prefer small, evidence-driven steps.

---

# 62. Recommended completion criteria

A task should be considered complete only when the requested level of evidence is satisfied.

For a simple file edit:

```text
file exists
content verified
```

For a scene change:

```text
scene saved
Godot validation passes
```

For gameplay:

```text
validation passes
runtime starts
Behavior assertions pass
```

For a complex feature:

```text
project structure verified
validation passes
runtime behavior verified
regression tests pass
repeated test pass
fuzz pass or known findings addressed
profile checked when relevant
```

For release:

```text
release readiness passes
release manifest/package created
exports succeed for requested presets
```

---

# 63. What GJM does not automatically prove

Even with many tools, GJM cannot infer every semantic property of a game.

Examples:

```text
"This is fun"
"This art is aesthetically good"
"The combat is balanced"
"The network is secure"
"The game is bug-free"
"The game is commercially ready"
```

Those require project-specific reasoning and human or domain evaluation.

GJM is strongest at making the engineering loop observable and automatable.

---

# 64. Recommended AI operating policy

Use this as a persistent system-level behavior when an AI works with GJM:

```text
GJM OPERATING POLICY

1. Discover the live MCP tools and schemas before inventing operations.
2. Treat projectRoot as the scope boundary for project operations.
3. Inspect before modifying unfamiliar projects.
4. Prefer the most structured available operation.
5. Use snapshots or transactions for risky edits.
6. Keep multi-step work bounded and observable.
7. Prefer deterministic tests and fixed seeds.
8. Validate after meaningful modifications.
9. Use runtime evidence for runtime claims.
10. Read structured errors before attempting repairs.
11. Make the smallest repair that explains the failure.
12. Re-run the exact failing test after repair.
13. Do not repeat an unsuccessful repair unchanged.
14. Parallelize only independent operations.
15. Use background jobs for genuinely long work.
16. Keep artifacts and evidence paths in the final report.
17. Do not claim completion when a required verification step was not run.
18. Distinguish scaffold generation from functional integration.
19. Distinguish parser/compile success from behavioral correctness.
20. Finish with release readiness and a reproducible release artifact when release is requested.
```

---

# 65. Fast reference: tool family map

```text
Project understanding
  gjm_context
  gjm_context_pack
  gjm_project_index
  gjm_dependency_graph
  gjm_audit

Safety / rollback
  gjm_snapshot_create
  gjm_snapshot_list
  gjm_snapshot_restore
  gjm_snapshot_delete
  gjm_transaction

Project creation / edit
  gjm_make_validate
  gjm_make_apply
  gjm_import_json
  gjm_workspace
  gjm_project
  gjm_scene_operations
  gjm_godot_script
  gjm_do_anything
  gjm_universal

Runtime
  gjm_run
  gjm_runtime_start
  gjm_runtime_status
  gjm_runtime_command
  gjm_runtime_stop
  gjm_runtime_inspect
  gjm_runtime_tree

gameplay tests
  gjm_behavior_validate
  gjm_run_behavior
  gjm_autoplay
  gjm_autoplay_fuzz
  gjm_export_mp4
  gjm_artifacts
  gjm_read_result

repair
  gjm_diagnose
  gjm_prepare_fix
  gjm_apply_fix
  gjm_session_start
  gjm_session_status
  gjm_next
  gjm_session_stop

assets
  gjm_model
  gjm_rig
  gjm_animation
  gjm_animation_edit
  gjm_shader
  gjm_shader_validate
  gjm_audio
  gjm_generate_wav
  gjm_generate_svg
  gjm_texture

input / network
  gjm_input
  gjm_input_audit
  gjm_network
  gjm_network_test

advanced engineering
  gjm_editor_plugin
  gjm_profile
  gjm_profile_compare
  gjm_studio
  gjm_studio_plan
  gjm_job_start
  gjm_job_status
  gjm_job_list
  gjm_job_cancel
  gjm_parallel

release
  gjm_release_readiness
  gjm_release

metadata
  gjm_server_info
  gjm_capabilities
  gjm_doctor
  gjm_environment
  gjm_template_list
  gjm_template_apply
  gjm_assets
  gjm_git
```

---

# 66. Final rule: build evidence, not just files

The strongest possible GJM workflow is not:

```text
AI -> generates files -> says done
```

It is:

```text
AI
 |
v
understands project
 |
v
protects working state
 |
v
changes project
 |
v
validates with Godot
 |
v
runs the game
 |
v
observes runtime
 |
v
executes deterministic tests
 |
v
fuzzes where useful
 |
v
profiles where useful
 |
v
diagnoses failures
 |
v
repairs with bounded attempts
 |
v
re-tests
 |
v
passes release gates
 |
v
packages/export
 |
v
returns evidence
```

That is the intended way to use GJM as an AI-first Godot engineering system.

---

# Appendix A — Minimal AI checklist

```text
[ ] Identify projectRoot
[ ] Inspect environment if needed
[ ] Inspect project context/index
[ ] Check dependencies for cross-file changes
[ ] Snapshot before risky edits
[ ] Choose structured tool before raw patch
[ ] Make change
[ ] Validate
[ ] Run if behavior changed
[ ] Inspect runtime when useful
[ ] Execute Behavior assertions
[ ] Repeat tests when reliability matters
[ ] Fuzz when input robustness matters
[ ] Profile before/after performance work
[ ] Diagnose failures from actual results
[ ] Apply smallest justified repair
[ ] Re-run the failing test
[ ] Run release readiness when appropriate
[ ] Package/export when requested
[ ] Report evidence and remaining limitations
```

---

# Appendix B — File format summary

## `godot.make.json`

```text
format: godot.make
version: integer >= 1
actions: array
```

Action type families:

```text
directory
file
script
shader
resource
asset_base64
copy
project_setting
input_action
autoload
template
scene
scene_raw
feature
godot_script
```

## `Behavior.json`

```text
format: godot.behavior
version: integer >= 1
actions: array
assertions: optional array
capture: optional object
```

---

# Appendix C — Current GJM 7.0.0 capability statement

GJM 7.0.0 is best understood as an **AI-controlled Godot engineering and verification layer over MCP**.

Its strongest differentiator is not merely the number of tools. It is the ability to connect:

```text
project understanding
+ structured editing
+ engine-backed execution
+ runtime inspection
+ automated tests
+ diagnostics
+ rollback
+ asset generation
+ profiling
+ fuzzing
+ long-running jobs
+ bounded parallelism
+ release gates
```

into one machine-readable engineering loop.

When an AI uses the system correctly, the unit of work should be a **verified change**, not merely a generated file.
