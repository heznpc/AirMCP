import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runAutomation } from "../shared/automation.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okUntrusted, toolError } from "../shared/result.js";
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

interface ContactSummary {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface ContactListResult {
  total: number;
  offset: number;
  returned: number;
  contacts: ContactSummary[];
}

interface ContactSearchItem {
  id: string;
  name: string;
  organization: string | null;
  email: string | null;
  phone: string | null;
  matchedField: string;
}

interface ContactSearchResult {
  total: number;
  returned: number;
  contacts: ContactSearchItem[];
}

interface ContactDetail {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  organization: string | null;
  jobTitle: string | null;
  department: string | null;
  note: string | null;
  emails: { value: string; label: string }[];
  phones: { value: string; label: string }[];
  addresses: { street: string; city: string; state: string; zip: string; country: string; label: string }[];
}

interface ContactMutationResult {
  id: string;
  name: string;
}

interface ContactDeleteResult {
  deleted: boolean;
  name: string;
}

interface GroupInfo {
  id: string;
  name: string;
}

interface ContactEmailAddedResult {
  id: string;
  name: string;
  addedEmail: string;
}

interface ContactPhoneAddedResult {
  id: string;
  name: string;
  addedPhone: string;
}

interface GroupMembersResult {
  group: string;
  total: number;
  returned: number;
  contacts: ContactSummary[];
}

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
        const result = await runAutomation<ContactListResult>({
          swift: { command: "list-contacts", input: { limit, offset } },
          jxa: () => listContactsScript(limit, offset),
        });
        return ok(result);
      } catch (e) {
        return toolError("list contacts", e);
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
        const result = await runAutomation<ContactSearchResult>({
          swift: { command: "search-contacts", input: { query, limit } },
          jxa: () => searchContactsScript(query, limit),
        });
        return ok(result);
      } catch (e) {
        return toolError("search contacts", e);
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
        const result = await runAutomation<ContactDetail>({
          swift: { command: "read-contact", input: { id } },
          jxa: () => readContactScript(id),
        });
        return okUntrusted(result);
      } catch (e) {
        return toolError("read contact", e);
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
        const result = await runAutomation<ContactMutationResult>({
          swift: { command: "create-contact", input: { firstName, lastName, email, phone, organization, jobTitle, note } },
          jxa: () => createContactScript(firstName, lastName, { email, phone, organization, jobTitle, note }),
        });
        return ok(result);
      } catch (e) {
        return toolError("create contact", e);
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
        const result = await runAutomation<ContactMutationResult>({
          swift: { command: "update-contact", input: { id, firstName, lastName, organization, jobTitle, note } },
          jxa: () => updateContactScript(id, { firstName, lastName, organization, jobTitle, note }),
        });
        return ok(result);
      } catch (e) {
        return toolError("update contact", e);
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
        const result = await runAutomation<ContactDeleteResult>({
          swift: { command: "delete-contact", input: { id } },
          jxa: () => deleteContactScript(id),
        });
        return ok(result);
      } catch (e) {
        return toolError("delete contact", e);
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
        const result = await runAutomation<GroupInfo[]>({
          swift: { command: "list-groups" },
          jxa: () => listGroupsScript(),
        });
        return ok(result);
      } catch (e) {
        return toolError("list groups", e);
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
        const result = await runAutomation<ContactEmailAddedResult>({
          swift: { command: "add-contact-email", input: { id, email, label } },
          jxa: () => addContactEmailScript(id, email, label),
        });
        return ok(result);
      } catch (e) {
        return toolError("add email to contact", e);
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
        const result = await runAutomation<ContactPhoneAddedResult>({
          swift: { command: "add-contact-phone", input: { id, phone, label } },
          jxa: () => addContactPhoneScript(id, phone, label),
        });
        return ok(result);
      } catch (e) {
        return toolError("add phone to contact", e);
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
        const result = await runAutomation<GroupMembersResult>({
          swift: { command: "list-group-members", input: { groupName, limit } },
          jxa: () => listGroupMembersScript(groupName, limit),
        });
        return ok(result);
      } catch (e) {
        return toolError("list group members", e);
      }
    },
  );
}
