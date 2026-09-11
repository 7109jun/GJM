# Godot-J-MCP (GJM) — AI Usage Guide

**Godot-J-MCP (GJM)** is an MCP server for AI-driven Godot development.

GJM is designed around a simple principle:

> **The AI describes a Godot project in JSON. GJM applies it, validates it, runs automated behavior, checks the result, records the run, and returns machine-readable evidence.**

The normal AI workflow is:

```text
AI
 ↓
godot.make.json
 ↓
GJM
 ↓
Apply project changes
 ↓
Godot validation
 ├─ failure → diagnose → repair → validate again
 └─ success
      ↓
   Behavior.json
      ↓
   Runtime input
      ↓
   Assertions
      ↓
   Recording
      ↓
   MP4
      ↓
   Artifacts
      ↓
   Result
      ↓
AI
```

---

# 1. What GJM Is

GJM is not just a file-management MCP.

It is a **Godot development and verification bridge for AI**.

GJM can handle:

* Godot project creation
* Project modification
* Scene creation
* Scene node creation
* Script creation
* Project settings
* Godot validation
* Runtime execution
* Keyboard input
* Mouse input
* Clicks
* Scrolling
* Screenshot checkpoints
* Automated assertions
* Error diagnostics
* AI repair loops
* Rollback snapshots
* Runtime artifacts
* MP4 generation
* Session management

The AI normally does not need to manipulate `.tscn` files manually.

Instead, the AI should describe the desired state through:

```text
godot.make.json
```

and describe runtime testing through:

```text
Behavior.json
```

---

# 2. The Two Important JSON Formats

GJM has two main AI-authored formats.

## 2.1 `godot.make.json`

This is the **project construction and modification format**.

It describes what the Godot project should contain.

Example:

```json
{
  "format": "godot.make",
  "version": 1,
  "name": "Example Game",
  "actions": [
    {
      "type": "directory",
      "path": "scripts"
    },
    {
      "type": "script",
      "path": "scripts/main.gd",
      "content": "extends Node2D\n\nfunc _ready():\n    print(\"GJM test game started\")\n"
    },
    {
      "type": "scene",
      "path": "main.tscn",
      "script": "res://scripts/main.gd",
      "root": {
        "name": "Main",
        "type": "Node2D"
      },
      "nodes": [
        {
          "name": "Label",
          "type": "Label",
          "properties": {
            "text": "Hello GJM"
          }
        }
      ]
    },
    {
      "type": "project_setting",
      "section": "application",
      "key": "run/main_scene",
      "value": "res://main.tscn"
    }
  ]
}
```

The supported top-level action types are:

```text
directory
file
script
project_setting
scene
```

---

# 3. `godot.make.json` Actions

## 3.1 Directory

Create a directory.

```json
{
  "type": "directory",
  "path": "scripts"
}
```

The path is relative to the Godot project root.

---

## 3.2 File

Create or overwrite a file.

```json
{
  "type": "file",
  "path": "README.txt",
  "content": "Created by GJM."
}
```

---

## 3.3 Script

Create or overwrite a script.

```json
{
  "type": "script",
  "path": "scripts/player.gd",
  "content": "extends CharacterBody2D\n\nfunc _ready():\n    print(\"Player ready\")\n"
}
```

A `script` action is functionally a file action intended for source code.

---

## 3.4 Project Setting

Set a Godot project property.

```json
{
  "type": "project_setting",
  "section": "application",
  "key": "run/main_scene",
  "value": "res://main.tscn"
}
```

The value may be a JSON primitive, array, or object.

---

## 3.5 Scene

Create a Godot scene.

```json
{
  "type": "scene",
  "path": "main.tscn",
  "root": {
    "name": "Main",
    "type": "Node2D"
  },
  "nodes": [
    {
      "name": "Player",
      "type": "CharacterBody2D"
    },
    {
      "name": "Label",
      "type": "Label",
      "properties": {
        "text": "Hello"
      }
    }
  ]
}
```

A scene can contain:

```text
root
nodes
script
```

A node can contain:

```text
name
type
parent
script
properties
```

---

# 4. Scene Node Rules

When creating a scene, prefer explicit structure.

Example:

```json
{
  "type": "scene",
  "path": "game.tscn",
  "root": {
    "name": "Game",
    "type": "Node2D"
  },
  "nodes": [
    {
      "name": "Player",
      "type": "CharacterBody2D"
    },
    {
      "name": "PlayerSprite",
      "type": "Sprite2D",
      "parent": "Player"
    }
  ]
}
```

The `parent` field identifies the logical parent node.

Scripts can be attached with:

```json
{
  "name": "Player",
  "type": "CharacterBody2D",
  "script": "res://scripts/player.gd"
}
```

Properties can be specified with:

```json
{
  "name": "Label",
  "type": "Label",
  "properties": {
    "text": "Hello",
    "position": [100, 100]
  }
}
```

Use Godot-compatible property values.

Do not invent property names and expect GJM to translate them.

---

# 5. Behavior.json

`Behavior.json` describes how the AI wants to interact with the running game.

Example:

```json
{
  "format": "godot.behavior",
  "version": 1,
  "name": "Basic acceptance test",
  "actions": [
    {
      "type": "wait",
      "ms": 500
    },
    {
      "type": "key_press",
      "key": "ENTER",
      "durationMs": 100
    },
    {
      "type": "click",
      "x": 640,
      "y": 360,
      "button": "left"
    },
    {
      "type": "screenshot",
      "name": "after_click"
    }
  ],
  "assertions": [
    {
      "type": "frames_min",
      "value": 1
    },
    {
      "type": "checkpoint",
      "name": "after_click"
    }
  ]
}
```

---

# 6. Behavior Actions

Supported actions:

```text
wait
key_down
key_up
key_press
mouse_move
mouse_down
mouse_up
click
double_click
scroll
screenshot
```

---

## 6.1 Wait

```json
{
  "type": "wait",
  "ms": 1000
}
```

Use waits after loading screens, animations, scene changes, or input.

Do not assume an action has visually completed immediately.

---

## 6.2 Key Down

```json
{
  "type": "key_down",
  "key": "W"
}
```

Use this when holding a key is important.

---

## 6.3 Key Up

```json
{
  "type": "key_up",
  "key": "W"
}
```

Always release keys that were intentionally held.

---

## 6.4 Key Press

```json
{
  "type": "key_press",
  "key": "ENTER",
  "durationMs": 100
}
```

This is usually preferable to manually creating a down/up pair for simple interactions.

---

## 6.5 Mouse Move

```json
{
  "type": "mouse_move",
  "x": 500,
  "y": 300
}
```

Coordinates are runtime window coordinates.

---

## 6.6 Mouse Down

```json
{
  "type": "mouse_down",
  "x": 500,
  "y": 300,
  "button": "left"
}
```

Buttons:

```text
left
right
middle
```

---

## 6.7 Mouse Up

```json
{
  "type": "mouse_up",
  "x": 500,
  "y": 300,
  "button": "left"
}
```

---

## 6.8 Click

```json
{
  "type": "click",
  "x": 500,
  "y": 300,
  "button": "left"
}
```

---

## 6.9 Double Click

```json
{
  "type": "double_click",
  "x": 500,
  "y": 300,
  "button": "left"
}
```

---

## 6.10 Scroll

```json
{
  "type": "scroll",
  "x": 500,
  "y": 300,
  "deltaY": -5
}
```

Optional fields:

```text
x
y
deltaX
deltaY
```

---

## 6.11 Screenshot

```json
{
  "type": "screenshot",
  "name": "menu_open"
}
```

Named screenshots become checkpoints.

Names should be unique and descriptive.

Good:

```text
main_menu
after_start
player_moved
settings_open
level_complete
```

Bad:

```text
test1
aaa
image
x
```

---

# 7. Assert
