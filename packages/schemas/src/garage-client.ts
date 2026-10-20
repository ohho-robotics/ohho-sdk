/*
 * Garage client — localStorage-backed robot CRUD for the SDK (no Supabase).
 */

import type { UserRobot, RobotStatus } from "./types";

const STORAGE_PREFIX = "ohho_garage_";
const ANON_KEY = "ohho_garage_anonymous";

function storageKey(userId?: string): string {
  if (userId) return `${STORAGE_PREFIX}${userId}`;
  return ANON_KEY;
}

function readLocal(userId?: string): UserRobot[] {
  if (typeof globalThis.localStorage === "undefined") return [];
  try {
    const raw = globalThis.localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as UserRobot[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(robots: UserRobot[], userId?: string): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    globalThis.localStorage.setItem(storageKey(userId), JSON.stringify(robots));
  } catch {
    // storage full — silently ignore
  }
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function now(): string {
  return new Date().toISOString();
}

/** Fetch all robots in the current user's garage. */
export async function getUserRobots(): Promise<UserRobot[]> {
  return readLocal();
}

/** Add a new robot to the user's garage. */
export async function addUserRobot(
  name: string,
  robotTypeId: string,
  hardwareModelId: string,
): Promise<UserRobot | null> {
  const newRobot: UserRobot = {
    id: generateId(),
    userId: "anonymous",
    name,
    robotTypeId,
    hardwareModelId,
    status: "draft" as RobotStatus,
    config: {},
    createdAt: now(),
    updatedAt: now(),
  };

  const existing = readLocal();
  existing.unshift(newRobot);
  writeLocal(existing);
  return newRobot;
}

/** Remove a robot from the user's garage. */
export async function deleteUserRobot(id: string): Promise<boolean> {
  const existing = readLocal();
  const filtered = existing.filter((r) => r.id !== id);
  if (filtered.length === existing.length) return false;
  writeLocal(filtered);
  return true;
}

/** Update a robot's configuration, name, or status. */
export async function updateUserRobot(
  id: string,
  updates: Partial<Pick<UserRobot, "name" | "status" | "config">>,
): Promise<UserRobot | null> {
  const existing = readLocal();
  const idx = existing.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  existing[idx] = { ...existing[idx], ...updates, updatedAt: now() };
  writeLocal(existing);
  return existing[idx];
}
