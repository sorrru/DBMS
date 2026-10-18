import { describe, expect, it } from "vitest";
import { SurveyModel } from "../src/models/survey.js";
import { SurveyVersionModel } from "../src/models/survey-version.js";

describe("survey indexes", () => {
  it("declares public, list, version and single-draft indexes", () => {
    expect(SurveyModel.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ publicId: 1 }, expect.objectContaining({ unique: true })],
        [{ ownerId: 1, updatedAt: -1, _id: -1 }, expect.any(Object)],
      ]),
    );
    expect(SurveyVersionModel.schema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { surveyId: 1, versionNumber: 1 },
          expect.objectContaining({ unique: true }),
        ],
        [
          { surveyId: 1, status: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: { status: "draft" },
          }),
        ],
      ]),
    );
  });
});
