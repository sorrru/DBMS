import { validationError } from "../errors/api-error.js";
import {
  object,
  exact,
  revision,
  validLibraryId,
} from "../library/validation.js";
export function bankName(body: unknown, editing = false) {
  const v = object(body);
  exact(v, editing ? ["name", "revision"] : ["name"]);
  if (typeof v.name !== "string" || !v.name.trim() || v.name.trim().length > 80)
    throw validationError("name");
  return {
    name: v.name.trim(),
    ...(editing ? { revision: revision(v.revision, "revision") } : {}),
  };
}
export function bankRevision(body: unknown) {
  const v = object(body);
  exact(v, ["revision"]);
  return revision(v.revision, "revision");
}
export function bankMember(
  body: unknown,
  editing = false,
): {
  libraryQuestionId: string;
  versionPolicy: "latest" | "pinned";
  questionVersionId: string | null;
  revision?: number;
} {
  const v = object(body);
  exact(v, [
    "libraryQuestionId",
    "versionPolicy",
    "questionVersionId",
    ...(editing ? ["revision"] : []),
  ]);
  if (v.versionPolicy !== "latest" && v.versionPolicy !== "pinned")
    throw validationError("versionPolicy");
  const questionVersionId =
    v.versionPolicy === "pinned"
      ? validLibraryId(v.questionVersionId, "questionVersionId")
      : null;
  if (
    v.versionPolicy === "latest" &&
    v.questionVersionId !== undefined &&
    v.questionVersionId !== null
  )
    throw validationError("questionVersionId");
  return {
    libraryQuestionId: validLibraryId(v.libraryQuestionId, "libraryQuestionId"),
    versionPolicy: v.versionPolicy,
    questionVersionId,
    ...(editing ? { revision: revision(v.revision, "revision") } : {}),
  };
}
