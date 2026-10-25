import {
  object,
  exact,
  revision,
  validLibraryId,
} from "../library/validation.js";
export function parseLibrarySelection(body: unknown) {
  const v = object(body);
  exact(v, [
    "revision",
    "libraryQuestionId",
    "questionVersionId",
    "contentRevision",
  ]);
  return {
    revision: revision(v.revision, "revision"),
    libraryQuestionId: validLibraryId(v.libraryQuestionId, "libraryQuestionId"),
    questionVersionId: validLibraryId(v.questionVersionId, "questionVersionId"),
    contentRevision: revision(v.contentRevision),
  };
}
