#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const targetId = process.argv[2];
const checkOnly = process.argv[3] === "--check";
if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(targetId || "") ||
    (process.argv[3] && !checkOnly) || process.argv.length > 4) {
  throw new Error("Usage: node scripts/rollback-pages-deployment.mjs <deployment-id> [--check]");
}

const token = process.env.CLOUDFLARE_API_TOKEN || JSON.parse(execFileSync(
  "npx", ["wrangler", "auth", "token", "--json"], { encoding: "utf8", timeout: 45_000 },
)).token;
if (!token) throw new Error("Cloudflare authentication unavailable");

const base = "https://api.cloudflare.com/client/v4/accounts/944914746b7fbc8cd91cd7d0d9d1940c/pages/projects/good-attic-website/deployments/";
async function call(path, method = "GET") {
  const response = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) {
    throw new Error(`Cloudflare Pages ${method} failed (HTTP ${response.status}): ${JSON.stringify(body.errors || [])}`);
  }
  return body.result;
}

const target = await call(targetId);
if (target.environment !== "production" || target.latest_stage?.status !== "success") {
  throw new Error("Rollback target is not a successful production deployment");
}
if (checkOnly) {
  console.log(`Rollback target verified: ${target.id}`);
} else {
  const restored = await call(`${targetId}/rollback`, "POST");
  console.log(`Pages rollback requested: target ${targetId}; deployment ${restored?.id || "accepted"}`);
}
