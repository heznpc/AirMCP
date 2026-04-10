import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runAutomation } from "../shared/automation.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okUntrustedStructured, okUntrustedLinkedStructured, toolError } from "../shared/result.js";
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

const zContactSummary = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

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
      outputSchema: {
        total: z.number(),
        offset: z.number(),
        returned: z.number(),
        contacts: z.array(zContactSummary),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ limit, offset }) => {
      try {
        const result = await runAutomation<ContactListResult>({
          swift: { command: "list-contacts", input: { limit, offset } },
          jxa: () => listContactsScript(limit, offset),
        });
        return okUntrustedLinkedStructured("list_contacts", result);
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
        query: z.string().max(500).describe("Search keyword (matches name)"),
        limit: z.number().int().min(1).max(500).optional().default(50).describe("Max results (default: 50)"),
      },
      outputSchema: {
        total: z.number(),
        returned: z.number(),
        contacts: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            organization: z.string().nullable(),
            email: z.string().nullable(),
            phone: z.string().nullable(),
            matchedField: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        const result = await runAutomation<ContactSearchResult>({
          swift: { command: "search-contacts", input: { query, limit } },
          jxa: () => searchContactsScript(query, limit),
        });
        return okUntrustedStructured(result);
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
        id: z.string().max(500).describe("Contact ID"),
      },
      outputSchema: {
        id: z.string(),
        name: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        organization: z.string().nullable(),
        jobTitle: z.string().nullable(),
        department: z.string().nullable(),
        note: z.string().nullable(),
        emails: z.array(z.object({ value: z.string(), label: z.string() })),
        phones: z.array(z.object({ value: z.string(), label: z.string() })),
        addresses: z.array(
          z.object({
            street: z.string(),
            city: z.string(),
            state: z.string(),
            zip: z.string(),
            country: z.string(),
            label: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      try {
        const result = await runAutomation<ContactDetail>({
          swift: { command: "read-contact", input: { id } },
          jxa: () => readContactScript(id),
        });
        return okUntrustedStructured(result);
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
        firstName: z.string().max(500).describe("First name"),
        lastName: z.string().max(500).describe("Last name"),
        email: z.string().email().optional().describe("Email address"),
        phone: z.string().min(1).optional().describe("Phone number"),
        organization: z.string().max(1000).optional().describe("Company/organization"),
        jobTitle: z.string().max(500).optional().describe("Job title"),
        note: z.string().max(5000).optional().describe("Notes"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ firstName, lastName, email, phone, organization, jobTitle, note }) => {
      try {
        const result = await runAutomation<ContactMutationResult>({
          swift: {
            command: "create-contact",
            input: { firstName, lastName, email, phone, organization, jobTitle, note },
          },
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
        id: z.string().max(500).describe("Contact ID"),
        firstName: z.string().max(500).optional().describe("New first name"),
        lastName: z.string().max(500).optional().describe("New last name"),
        organization: z.string().max(1000).optional().describe("New organization"),
        jobTitle: z.string().max(500).optional().describe("New job title"),
        note: z.string().max(5000).optional().describe("New notes"),
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
        id: z.string().max(500).describe("Contact ID"),
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
        id: z.string().max(500).describe("Contact ID"),
        email: z.string().email().describe("Email address to add"),
        label: z.string().max(500).optional().default("work").describe("Email label (default: work)"),
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
        id: z.string().max(500).describe("Contact ID"),
        phone: z.string().min(1).max(1000).describe("Phone number to add"),
        label: z.string().max(500).optional().default("mobile").describe("Phone label (default: mobile)"),
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
        groupName: z.string().max(500).describe("Group name"),
        limit: z.number().int().min(1).max(1000).optional().default(100).describe("Max contacts (default: 100)"),
      },
      outputSchema: {
        group: z.string(),
        total: z.number(),
        returned: z.number(),
        contacts: z.array(zContactSummary),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ groupName, limit }) => {
      try {
        const result = await runAutomation<GroupMembersResult>({
          swift: { command: "list-group-members", input: { groupName, limit } },
          jxa: () => listGroupMembersScript(groupName, limit),
        });
        return okUntrustedStructured(result);
      } catch (e) {
        return toolError("list group members", e);
      }
    },
  );
}
