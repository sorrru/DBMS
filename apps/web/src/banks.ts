import { apiRequest } from "./auth";
import type { LibraryVersionView } from "./library";
export interface Bank {
  bankId: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface BankItem {
  itemId: string;
  libraryQuestionId: string;
  versionPolicy: "latest" | "pinned";
  questionVersionId: string | null;
  revision: number;
  available: boolean;
  version: LibraryVersionView | null;
}
export interface BankPage {
  items: Bank[];
  nextCursor: string | null;
}
export interface BankItemPage {
  bank: Bank;
  items: BankItem[];
  nextCursor: string | null;
}
const root = "/api/question-banks";
const query = (cursor?: string) =>
  `?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const listBanks = (cursor?: string) =>
  apiRequest<BankPage>(`${root}${query(cursor)}`);
export const createBank = (name: string) =>
  apiRequest<Bank>(root, json("POST", { name }));
export const renameBank = (bank: Bank, name: string) =>
  apiRequest<Bank>(
    `${root}/${bank.bankId}`,
    json("PATCH", { name, revision: bank.revision }),
  );
export const deleteBank = (bank: Bank) =>
  apiRequest<void>(
    `${root}/${bank.bankId}`,
    json("DELETE", { revision: bank.revision }),
  );
export const listBankItems = (id: string, cursor?: string) =>
  apiRequest<BankItemPage>(`${root}/${id}/items${query(cursor)}`);
export const saveBankItem = (
  id: string,
  libraryQuestionId: string,
  policy: "latest" | "pinned",
  versionId: string,
  item?: BankItem,
) =>
  apiRequest<{ accepted: true }>(
    `${root}/${id}/items${item ? `/${item.itemId}` : ""}`,
    json(item ? "PUT" : "POST", {
      libraryQuestionId,
      versionPolicy: policy,
      questionVersionId: policy === "pinned" ? versionId : null,
      ...(item ? { revision: item.revision } : {}),
    }),
  );
export const removeBankItem = (id: string, item: BankItem) =>
  apiRequest<void>(
    `${root}/${id}/items/${item.itemId}`,
    json("DELETE", { revision: item.revision }),
  );
