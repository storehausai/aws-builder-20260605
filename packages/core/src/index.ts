/**
 * @pebble/core — the shared contracts.
 *
 * This package is the CUT-LINE for parallel work: once these types, ports,
 * and signatures are fixed, Track A (providers/ingestion) and Track B
 * (engine + agent) build against them independently. It has no runtime code
 * and no dependencies — only types.
 */

export * from "./primitives";
export * from "./raw";
export * from "./canonical";
export * from "./ports";
export * from "./engine";
export * from "./market-mover";
export * from "./panel";
export * from "./panel-data";
export * from "./ingest";
