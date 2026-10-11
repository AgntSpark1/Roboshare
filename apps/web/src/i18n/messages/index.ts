import type { Locale } from "../locales";
import { en } from "./en";
import { es } from "./es";
import { id } from "./id";
import { ja } from "./ja";
import { ko } from "./ko";
import { th } from "./th";
import { vi } from "./vi";
import { zhCN, type Messages } from "./zh-CN";
import { zhTW } from "./zh-TW";

export type { Messages };

export const MESSAGES: Record<Locale, Messages> = { "zh-CN": zhCN, "zh-TW": zhTW, en, ja, ko, vi, th, id, es };
