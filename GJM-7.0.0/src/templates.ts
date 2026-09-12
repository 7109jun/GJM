import type { GodotMake, MakeAction } from './types.js';

export type GameTemplateName =
  | 'platformer_2d'
  | 'topdown_2d'
  | 'third_person_3d'
  | 'first_person_3d'
  | 'ui_menu'
  | 'save_system'
  | 'audio_manager';

function actionScript(path: string, content: string): MakeAction {
  return { type: 'script', path, content };
}
function scene(path: string, root: any, nodes: any[] = [], subresources: any[] = [], connections: any[] = []): MakeAction {
  return { type: 'scene', path, root, nodes, subresources, connections };
}

function platformer3(): MakeAction[] {
  return [
    actionScript('scripts/player.gd', `extends KinematicBody2D\n\nexport var speed = 240.0\nexport var jump_speed = -420.0\nexport var gravity = 1100.0\nvar velocity = Vector2()\n\nfunc _physics_process(delta):\n    velocity.x = 0.0\n    if Input.is_action_pressed("move_left"):\n        velocity.x -= speed\n    if Input.is_action_pressed("move_right"):\n        velocity.x += speed\n    velocity.y += gravity * delta\n    if is_on_floor() and Input.is_action_just_pressed("jump"):\n        velocity.y = jump_speed\n    velocity = move_and_slide(velocity, Vector2.UP)\n`),
    scene('main.tscn', { name: 'Main', type: 'Node2D' }, [
      { name: 'Player', type: 'KinematicBody2D', script: 'res://scripts/player.gd', properties: { position: { $type: 'Vector2', value: [160, 220] } }, children: [ { name: 'CollisionShape2D', type: 'CollisionShape2D' } ] },
      { name: 'Ground', type: 'StaticBody2D', properties: { position: { $type: 'Vector2', value: [320, 360] } }, children: [ { name: 'CollisionShape2D', type: 'CollisionShape2D' } ] },
      { name: 'Camera', type: 'Camera2D', parent: 'Player' },
      { name: 'CanvasLayer', type: 'CanvasLayer' },
      { name: 'Title', type: 'Label', parent: 'CanvasLayer', properties: { text: 'GJM Platformer', position: { $type: 'Vector2', value: [24, 20] } } }
    ], [
      { id: 'player_shape', type: 'RectangleShape2D', properties: { extents: { $type: 'Vector2', value: [20, 30] } } },
      { id: 'ground_shape', type: 'RectangleShape2D', properties: { extents: { $type: 'Vector2', value: [320, 20] } } }
    ]),
    { type: 'project_setting', section: 'application', key: 'run/main_scene', value: 'res://main.tscn' }
  ];
}

function topdown3(): MakeAction[] {
  return [
    actionScript('scripts/player.gd', `extends KinematicBody2D\nexport var speed = 220.0\nfunc _physics_process(_delta):\n    var input = Vector2()\n    input.x = Input.get_action_strength("move_right") - Input.get_action_strength("move_left")\n    input.y = Input.get_action_strength("move_down") - Input.get_action_strength("move_up")\n    move_and_slide(input.normalized() * speed)\n`),
    scene('main.tscn', { name: 'Main', type: 'Node2D' }, [
      { name: 'Player', type: 'KinematicBody2D', script: 'res://scripts/player.gd', properties: { position: { $type: 'Vector2', value: [320, 240] } } },
      { name: 'Camera', type: 'Camera2D', parent: 'Player' },
      { name: 'World', type: 'Node2D' },
      { name: 'HUD', type: 'CanvasLayer', children: [ { name: 'Label', type: 'Label', parent: '.', properties: { text: 'GJM Topdown' } } ] }
    ]),
    { type: 'project_setting', section: 'application', key: 'run/main_scene', value: 'res://main.tscn' }
  ];
}

function thirdPerson4(): MakeAction[] {
  return [
    actionScript('scripts/player.gd', `extends CharacterBody3D\n@export var speed := 5.0\n@export var gravity := 18.0\nfunc _physics_process(delta):\n    var input_vec = Input.get_vector("move_left", "move_right", "move_forward", "move_back")\n    var dir = Vector3(input_vec.x, 0.0, input_vec.y)\n    velocity.x = dir.x * speed\n    velocity.z = dir.z * speed\n    if not is_on_floor(): velocity.y -= gravity * delta\n    move_and_slide()\n`),
    scene('main.tscn', { name: 'Main', type: 'Node3D' }, [
      { name: 'Player', type: 'CharacterBody3D', script: 'res://scripts/player.gd', properties: { position: { $type: 'Vector3', value: [0, 1, 0] } }, children: [
        { name: 'Camera', type: 'Camera3D', parent: '.', properties: { position: { $type: 'Vector3', value: [0, 2, 6] } } }
      ] },
      { name: 'WorldEnvironment', type: 'WorldEnvironment' },
      { name: 'Light', type: 'DirectionalLight3D' },
      { name: 'Ground', type: 'StaticBody3D' },
      { name: 'HUD', type: 'CanvasLayer' }
    ]),
    { type: 'project_setting', section: 'application', key: 'run/main_scene', value: 'res://main.tscn' }
  ];
}

function firstPerson4(): MakeAction[] {
  return [
    actionScript('scripts/player.gd', `extends CharacterBody3D\n@export var speed := 5.0\nvar look := Vector2()\nfunc _unhandled_input(event):\n    if event is InputEventMouseMotion:\n        rotate_y(-event.relative.x * 0.002)\nfunc _physics_process(_delta):\n    var input_vec = Input.get_vector("move_left", "move_right", "move_forward", "move_back")\n    var dir = (transform.basis * Vector3(input_vec.x, 0, input_vec.y)).normalized()\n    velocity.x = dir.x * speed\n    velocity.z = dir.z * speed\n    move_and_slide()\n`),
    scene('main.tscn', { name: 'Main', type: 'Node3D' }, [
      { name: 'Player', type: 'CharacterBody3D', script: 'res://scripts/player.gd', children: [ { name: 'Camera', type: 'Camera3D', parent: '.' } ] },
      { name: 'Light', type: 'DirectionalLight3D' },
      { name: 'Environment', type: 'WorldEnvironment' },
      { name: 'Ground', type: 'StaticBody3D' }
    ]),
    { type: 'project_setting', section: 'application', key: 'run/main_scene', value: 'res://main.tscn' }
  ];
}

function uiMenu(): MakeAction[] {
  return [
    actionScript('scripts/menu.gd', `extends Control\nfunc _on_play_pressed():\n    get_tree().change_scene("res://main.tscn")\n`),
    scene('menu.tscn', { name: 'Menu', type: 'Control', script: 'res://scripts/menu.gd' }, [
      { name: 'Title', type: 'Label', properties: { text: 'My Game' } },
      { name: 'Play', type: 'Button', properties: { text: 'Play' } },
      { name: 'Settings', type: 'Button', properties: { text: 'Settings' } },
      { name: 'Quit', type: 'Button', properties: { text: 'Quit' } }
    ]),
    { type: 'project_setting', section: 'application', key: 'run/main_scene', value: 'res://menu.tscn' }
  ];
}

function saveSystem(): MakeAction[] {
  return [
    actionScript('scripts/save_system.gd', `extends Node\nconst SAVE_PATH = "user://savegame.json"\nfunc save_game(data):\n    var file = File.new()\n    if file.open(SAVE_PATH, File.WRITE) != OK: return false\n    file.store_string(to_json(data))\n    file.close()\n    return true\nfunc load_game():\n    var file = File.new()\n    if not file.file_exists(SAVE_PATH): return {}\n    if file.open(SAVE_PATH, File.READ) != OK: return {}\n    var data = parse_json(file.get_as_text())\n    file.close()\n    return data if typeof(data) == TYPE_DICTIONARY else {}\n`),
    { type: 'autoload', name: 'SaveSystem', path: 'res://scripts/save_system.gd' }
  ];
}

function audioManager(): MakeAction[] {
  return [
    actionScript('scripts/audio_manager.gd', `extends Node\nvar music_player\nfunc _ready():\n    music_player = AudioStreamPlayer.new()\n    add_child(music_player)\nfunc play(stream):\n    music_player.stream = stream\n    music_player.play()\nfunc stop():\n    music_player.stop()\n`),
    { type: 'autoload', name: 'AudioManager', path: 'res://scripts/audio_manager.gd' }
  ];
}

export function expandTemplates(names: string[], godotMajor: number): MakeAction[] {
  const actions: MakeAction[] = [];
  for (const name of names) {
    switch (name as GameTemplateName) {
      case 'platformer_2d': actions.push(...platformer3()); break;
      case 'topdown_2d': actions.push(...topdown3()); break;
      case 'third_person_3d': actions.push(...(godotMajor >= 4 ? thirdPerson4() : topdown3())); break;
      case 'first_person_3d': actions.push(...(godotMajor >= 4 ? firstPerson4() : topdown3())); break;
      case 'ui_menu': actions.push(...uiMenu()); break;
      case 'save_system': actions.push(...saveSystem()); break;
      case 'audio_manager': actions.push(...audioManager()); break;
      default: throw new Error(`Unknown GJM game template: ${name}`);
    }
  }
  return actions;
}
