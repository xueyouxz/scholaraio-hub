/**
 * What the library service answers with. The shapes are generated from its
 * OpenAPI document (`pnpm gen:library-types`): change a field in
 * packages/scholaraio/scholaraio/interfaces/api/responses.py, never here.
 */
import type { components } from "./generated/library-api.js";

type Schemas = components["schemas"];

export type LiteratureProject = Schemas["LiteratureProject"];
export type LibraryPaper = Schemas["LibraryPaper"];
export type LibraryPaperDetail = Schemas["LibraryPaperDetail"];
export type LibraryCitation = Schemas["LibraryCitation"];
export type LibraryContext = Schemas["LibraryContext"];
export type ImportJob = Schemas["ImportJob"];
export type FetchedImportJob = Schemas["FetchedImportJob"];
export type DiscoveredPaper = Schemas["DiscoveredPaper"];
export type DiscoverResponse = Schemas["DiscoverResponse"];
export type SettingsCheck = Schemas["SettingsCheck"];
export type LibraryReference = Schemas["LibraryReference"];
export type ReadingPosition = Schemas["ReadingPosition"];
export type LibraryTask = Schemas["LibraryTask"];
export type LibraryTaskKind = LibraryTask["kind"];
export type LibraryCapabilities = Schemas["LibraryCapabilities"];
export type LibrarySettings = Schemas["LibrarySettings"];
export type LibraryTopic = Schemas["LibraryTopic"];
export type ProjectionPoint = Schemas["ProjectionPoint"];
export type LibraryAnalytics = Schemas["LibraryAnalytics"];
export type LibrarySearchResponse = Schemas["LibrarySearchResponse"];
export type ArchivedProject = Schemas["ArchivedProject"];
export type ExportFile = Schemas["ExportFile"];

/** How installing the optional embedding packages is going. */
export type VectorRuntimeStatus = Schemas["RuntimeInstallStatus"];
