import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, parseLang, translator } from "./i18n";

export async function getLang() {
  return parseLang((await cookies()).get(LANG_COOKIE)?.value);
}

export async function getT() {
  return translator(await getLang());
}
