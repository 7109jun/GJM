export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue; }

export type GodotTypedValue = {
  $type: 'Vector2' | 'Vector3' | 'Vector2i' | 'Vector3i' | 'Color' | 'Rect2' | 'Rect2i' | 'Plane' | 'Quaternion' | 'Basis' | 'Transform2D' | 'Transform3D' | 'NodePath' | 'SubResource' | 'ExtResource';
  value: JsonValue;
};

export interface MakeDirectoryAction { type: 'directory'; path: string; }
export interface MakeFileAction { type: 'file' | 'script' | 'shader' | 'resource'; path: string; content: string; encoding?: 'utf8'; }
export interface MakeAssetBase64Action { type: 'asset_base64'; path: string; content: string; }
export interface MakeCopyAction { type: 'copy'; from: string; to: string; }
export interface MakeProjectSettingAction { type: 'project_setting'; section: string; key: string; value: JsonValue | GodotTypedValue; }
export interface MakeInputAction { type: 'input_action'; name: string; deadzone?: number; events?: JsonValue[]; }
export interface MakeAutoloadAction { type: 'autoload'; name: string; path: string; enabled?: boolean; }
export interface MakeTemplateAction { type: 'template'; name: string; options?: Record<string, JsonValue>; }
export interface MakeSceneResource {
  id: string;
  type: string;
  path?: string;
  resource?: JsonValue;
}
export interface MakeSceneSubresource {
  id: string;
  type: string;
  properties?: Record<string, JsonValue | GodotTypedValue>;
}
export interface MakeNodeSpec {
  name: string;
  type: string;
  parent?: string;
  script?: string;
  properties?: Record<string, JsonValue | GodotTypedValue>;
  children?: MakeNodeSpec[];
}

export type MakeFeatureKind =
  | '2d_root' | '3d_root' | 'hybrid_root'
  | 'player_2d' | 'player_3d' | 'static_body_2d' | 'rigid_body_2d' | 'static_body_3d' | 'rigid_body_3d'
  | 'collision_shape_2d' | 'collision_shape_3d' | 'camera_2d' | 'camera_3d'
  | 'directional_light' | 'omni_light' | 'spot_light' | 'world_environment'
  | 'particles_2d' | 'particles_3d' | 'audio_player' | 'audio_2d' | 'audio_3d'
  | 'animation_player' | 'timer' | 'http_request' | 'navigation_2d' | 'navigation_3d'
  | 'sprite_2d' | 'mesh_instance_3d' | 'ui_label' | 'ui_button' | 'ui_panel' | 'ui_root' | 'line_2d' | 'line_3d';
export interface MakeFeatureAction {
  type: 'feature';
  kind: MakeFeatureKind;
  scene?: string;
  name?: string;
  parent?: string;
  properties?: Record<string, JsonValue | GodotTypedValue>;
  script?: string;
}
export interface MakeSceneAction {
  type: 'scene';
  path: string;
  root?: { name?: string; type?: string; script?: string; properties?: Record<string, JsonValue | GodotTypedValue> };
  nodes?: MakeNodeSpec[];
  resources?: MakeSceneResource[];
  subresources?: MakeSceneSubresource[];
  connections?: Array<{ signal: string; from: string; to: string; method: string; binds?: JsonValue[]; flags?: number }> ;
  script?: string;
}
export interface MakeRawSceneAction { type: 'scene_raw'; path: string; content: string; }
export interface MakeGodotScriptTaskAction { type: 'godot_script'; script: string; timeoutMs?: number; args?: string[]; resultFile?: string; }

export type MakeAction =
  | MakeDirectoryAction | MakeFileAction | MakeAssetBase64Action | MakeCopyAction | MakeProjectSettingAction
  | MakeInputAction | MakeAutoloadAction | MakeTemplateAction | MakeSceneAction | MakeRawSceneAction | MakeFeatureAction | MakeGodotScriptTaskAction;

export interface GodotMake {
  format: 'godot.make';
  version: number;
  name?: string;
  description?: string;
  project?: { name?: string; config_version?: number; [key: string]: unknown };
  actions: MakeAction[];
}

export type BehaviorKeyAction = { type: 'key_down' | 'key_up' | 'key_press'; key: string; durationMs?: number; };
export type BehaviorMouseAction = { type: 'mouse_move' | 'mouse_down' | 'mouse_up' | 'click' | 'double_click' | 'click_node'; x: number; y: number; button?: 'left' | 'right' | 'middle'; };
export type BehaviorScroll = { type: 'scroll'; x?: number; y?: number; deltaX?: number; deltaY?: number; };
export type BehaviorWait = { type: 'wait'; ms: number };
export type BehaviorScreenshot = { type: 'screenshot'; name?: string };
export type BehaviorInspect = { type: 'inspect_node'; path: string; label?: string };
export type BehaviorRuntime = { type: 'runtime_command'; op: string; path?: string; property?: string; value?: JsonValue; method?: string; args?: JsonValue[] };
export type BehaviorAction = BehaviorWait | BehaviorKeyAction | BehaviorMouseAction | BehaviorScroll | BehaviorScreenshot | BehaviorInspect | BehaviorRuntime;

export type BehaviorAssertion =
  | { type: 'frames_min'; value: number }
  | { type: 'checkpoint'; name: string }
  | { type: 'stdout_contains'; value: string }
  | { type: 'stderr_not_contains'; value: string }
  | { type: 'file_exists'; path: string }
  | { type: 'file_contains'; path: string; value: string }
  | { type: 'stdout_regex'; pattern: string }
  | { type: 'exit_code'; value: number }
  | { type: 'node_exists'; path: string }
  | { type: 'node_property'; path: string; property: string; equals: JsonValue };

export interface BehaviorFile {
  format: 'godot.behavior';
  version: number;
  name?: string;
  description?: string;
  actions: BehaviorAction[];
  assertions?: BehaviorAssertion[];
  capture?: { fps?: number; width?: number; height?: number; outputName?: string; codec?: string; };
}

export interface CommandResult { code: number; signal?: string; stdout: string; stderr: string; timedOut?: boolean; }
export interface GjmResult { ok: boolean; code: string; phase?: string; message: string; data?: unknown; }
export type JsonImportKind = 'make' | 'behavior';
