import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, err } from "../shared/result.js";
import {
  listContactsScript,
  searchContactsScript,
  readContactScript,
  createContactScript,
  updateContactScript,
  deleteContactScript,
  listGroupsScript,
  addContactEmailScript,
  addContactPhoneScript,
  listGroupMembersScript,
} from "./scripts.js";

export function registerContactTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "list_contacts",
    {
      title: "List Contacts",
      description: "List contacts with name, primary email, and phone. Supports pagination.",
      inputSchema: {
        limit: z.number().int().min(1).max(1000).optional().default(100).describe("Max contacts (default: 100)"),
        offset: z.number().int().min(0).optional().default(0).describe("Skip N contacts (default: 0)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ limit, offset }) => {
      try {
        return ok(await runJxa(listContactsScript(limit, offset)));
      } catch (e) {
        return err(`Failed to list contacts: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "search_contacts",
    {
      title: "Search Contacts",
      description: "Search contacts by name, email, phone, or organization.",
      inputSchema: {
        query: z.string().describe("Search keyword (matches name)"),
        limit: z.number().int().min(1).max(500).optional().default(50).describe("Max results (default: 50)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        return ok(await runJxa(searchContactsScript(query, limit)));
      } catch (e) {
        return err(`Failed to search contacts: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "read_contact",
    {
      title: "Read Contact",
      description: "Read full details of a contact by ID including all emails, phones, and addresses.",
      inputSchema: {
        id: z.string().describe("Contact ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      try {
        return ok(await runJxa(readContactScript(id)));
      } catch (e) {
        return err(`Failed to read contact: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "create_contact",
    {
      title: "Create Contact",
      description: "Create a new contact with name and optional email, phone, organization.",
      inputSchema: {
        firstName: z.string().describe("First name"),
        lastName: z.string().describe("Last name"),
        email: z.string().email().optional().describe("Email address"),
        phone: z.string().min(1).optional().describe("Phone number"),
        organization: z.string().optional().describe("Company/organization"),
        jobTitle: z.string().optional().describe("Job title"),
        note: z.string().optional().describe("Notes"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ firstName, lastName, email, phone, organization, jobTitle, note }) => {
      try {
        return ok(await runJxa(createContactScript(firstName, lastName, { email, phone, organization, jobTitle, note })));
      } catch (e) {
        return err(`Failed to create contact: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "update_contact",
    {
      title: "Update Contact",
      description: "Update contact properties. Only specified fields are changed.",
      inputSchema: {
        id: z.string().describe("Contact ID"),
        firstName: z.string().optional().describe("New first name"),
        lastName: z.string().optional().describe("New last name"),
        organization: z.string().optional().describe("New organization"),
        jobTitle: z.string().optional().describe("New job title"),
        note: z.string().optional().describe("New notes"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, firstName, lastName, organization, jobTitle, note }) => {
      try {
        return ok(await runJxa(updateContactScript(id, { firstName, lastName, organization, jobTitle, note })));
      } catch (e) {
        return err(`Failed to update contact: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "delete_contact",
    {
      title: "Delete Contact",
      description: "Delete a contact by ID. This action is permanent.",
      inputSchema: {
        id: z.string().describe("Contact ID"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      try {
        return ok(await runJxa(deleteContactScript(id)));
      } catch (e) {
        return err(`Failed to delete contact: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "list_groups",
    {
      title: "List Contact Groups",
      description: "List all contact groups.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(listGroupsScript()));
      } catch (e) {
        return err(`Failed to list groups: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "add_contact_email",
    {
      title: "Add Contact Email",
      description: "Add an email address to an existing contact.",
      inputSchema: {
        id: z.string().describe("Contact ID"),
        email: z.string().email().describe("Email address to add"),
        label: z.string().optional().default("work").describe("Email label (default: work)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, email, label }) => {
      try {
        return ok(await runJxa(addContactEmailScript(id, email, label)));
      } catch (e) {
        return err(`Failed to add email to contact: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "add_contact_phone",
    {
      title: "Add Contact Phone",
      description: "Add a phone number to an existing contact.",
      inputSchema: {
        id: z.string().describe("Contact ID"),
        phone: z.string().min(1).describe("Phone number to add"),
        label: z.string().optional().default("mobile").describe("Phone label (default: mobile)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, phone, label }) => {
      try {
        return ok(await runJxa(addContactPhoneScript(id, phone, label)));
      } catch (e) {
        return err(`Failed to add phone to contact: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "list_group_members",
    {
      title: "List Group Members",
      description: "List contacts in a specific group.",
      inputSchema: {
        groupName: z.string().describe("Group name"),
        limit: z.number().int().min(1).max(1000).optional().default(100).describe("Max contacts (default: 100)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ groupName, limit }) => {
      try {
        return ok(await runJxa(listGroupMembersScript(groupName, limit)));
      } catch (e) {
        return err(`Failed to list group members: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
