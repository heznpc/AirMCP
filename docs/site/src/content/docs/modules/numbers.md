---
title: Numbers
description: Apple Numbers automation -- spreadsheets, sheets, cell read/write, export to PDF.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `numbers_list_documents` | List all open Numbers spreadsheets. | ✅ |
| `numbers_create_document` | Create a new blank Numbers spreadsheet. | ❌ |
| `numbers_list_sheets` | List all sheets (tabs) in a Numbers spreadsheet. | ✅ |
| `numbers_get_cell` | Read a single cell value by address (e.g. 'A1'). | ✅ |
| `numbers_set_cell` | Write a value to a single cell. | ❌ |
| `numbers_read_cells` | Read a range of cells from a sheet. Uses 0-based row/column indices. | ✅ |
| `numbers_add_sheet` | Add a new sheet to a Numbers spreadsheet. | ❌ |
| `numbers_export_pdf` | Export a Numbers spreadsheet to PDF. Will overwrite an existing file at the same path. | ❌ |
| `numbers_close_document` | Close an open Numbers spreadsheet, optionally saving changes. | ❌ |

## Quick Examples

```
// Browse spreadsheets
"List my open Numbers documents"

// Read data
"Read cell A1 from sheet 'Sales' in 'Budget 2025'"
"Read cells from row 0, column 0 to row 10, column 5"

// Write data
"Set cell B2 in sheet 'Sales' to '42000'"

// Export
"Export 'Budget 2025' to PDF at /tmp/budget.pdf"
```

## Permissions

Requires **Automation** permission for Apple Numbers. Spreadsheets must be open in Numbers to be accessed by these tools.
