// Shared message type constants
export const MSG = Object.freeze({
  NEW_CLIP:       "NEW_CLIP",
  EMBED_AND_SAVE: "EMBED_AND_SAVE",
  SEARCH_CLIPS:   "SEARCH_CLIPS",
  GET_ALL_CLIPS:  "GET_ALL_CLIPS",
  DELETE_CLIP:    "DELETE_CLIP",
  CLEAR_ALL:      "CLEAR_ALL",
  GET_COUNT:      "GET_COUNT",
  CLIP_SAVED:     "CLIP_SAVED",
  OFFSCREEN_READY:"OFFSCREEN_READY",
  OPEN_SIDE_PANEL:"OPEN_SIDE_PANEL",
  ADD_NOTE:       "ADD_NOTE",
  ADD_TASK:       "ADD_TASK",
  TOGGLE_TASK:    "TOGGLE_TASK",
  RESCHEDULE_TASK:"RESCHEDULE_TASK",
  EXPORT_DATA:    "EXPORT_DATA",
  IMPORT_DATA:    "IMPORT_DATA",
  QUERY_NOTES:    "QUERY_NOTES",
  AI_QUERY:       "AI_QUERY",
  SAVE_CONFIG:    "SAVE_CONFIG",
  GET_CONFIG:     "GET_CONFIG",
});

export const DB = Object.freeze({
  NAME:    "contexto_db",
  VERSION: 2,
  STORE:   "clips",
});

export const EMBED_DIM = 256;
export const MAX_CLIPS = 2000;
export const MAX_RESULTS = 50;
