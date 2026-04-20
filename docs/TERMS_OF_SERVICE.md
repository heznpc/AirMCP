# Terms of Service

**AirMCP** — macOS MCP Server for Apple Ecosystem Automation
**npm package:** `airmcp`
**Developer:** heznpc (individual developer)
**Effective Date:** March 16, 2026

---

## 1. Acceptance of Terms

By installing, configuring, or using AirMCP in any capacity, you agree to be bound by these Terms of Service. If you do not agree, do not use the software.

## 2. License

AirMCP is open-source software released under the [MIT License](../LICENSE). The software is provided "as is", without warranty of any kind, express or implied. Refer to the full license text for details.

## 3. User Responsibilities

You are solely responsible for:

- **AI agent actions.** AirMCP enables AI agents to perform actions on your Mac through 269 tools across 29 modules. Any action an AI agent takes through AirMCP is performed on your behalf and at your direction. You are responsible for the outcomes of those actions.
- **Safety controls.** AirMCP provides a Human-in-the-Loop (HITL) approval system with configurable levels. It is your responsibility to configure an appropriate HITL level for your use case. Running AirMCP with HITL disabled means AI agents can execute destructive actions without confirmation.
- **HTTP mode security.** If you enable HTTP mode for remote access, you are responsible for securing it. This includes configuring token-based authentication, restricting network access, and ensuring the server is not exposed to untrusted networks.
- **Legal compliance.** You must comply with all applicable local, state, national, and international laws when using AirMCP. This includes laws governing privacy, electronic communications, data protection, and computer access.

## 4. Destructive Actions

AirMCP can perform actions that are irreversible or have significant consequences, including but not limited to:

- Deleting files and folders on your system
- Sending messages (iMessage) and emails (Mail) on your behalf
- Controlling system power (shutdown, restart, sleep)
- Modifying application data (calendars, contacts, reminders, notes)
- Executing shell commands and AppleScript/JXA code
- Controlling system settings and accessibility features

**You assume all risk associated with these capabilities.** The developer is not responsible for any unintended actions, data loss, or consequences resulting from the use of AirMCP, whether caused by misconfiguration, AI agent behavior, or software defects.

## 5. No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE SOFTWARE IS WITH YOU.

## 6. Limitation of Liability

IN NO EVENT SHALL THE DEVELOPER BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. THIS INCLUDES, WITHOUT LIMITATION, LIABILITY FOR:

- Loss or corruption of data
- Messages or emails sent without your intent
- System damage, downtime, or unintended power state changes
- Any consequences of AI agent actions executed through AirMCP
- Security breaches resulting from misconfigured HTTP mode

## 7. Third-Party Services

AirMCP optionally integrates with the following external services:

- **Google Gemini API** — used for text embeddings (requires your own API key)
- **Open-Meteo** — used for weather data (free, open API)
- **Nominatim (OpenStreetMap)** — used for geocoding (free, open API)

Your use of these services is subject to their respective terms of service and privacy policies. The developer is not responsible for the availability, accuracy, or conduct of any third-party service. You are responsible for providing and safeguarding your own API keys.

## 8. Privacy

AirMCP's data handling practices are described in [PRIVACY_POLICY.md](PRIVACY_POLICY.md). By using AirMCP, you also agree to the terms outlined in that document.

## 9. Modifications

These terms may be updated from time to time. Changes will be reflected in this document with an updated effective date. Continued use of AirMCP after changes are published constitutes acceptance of the revised terms. For significant changes, a notice may be included in the project's release notes or repository.

## 10. Governing Law

These terms shall be governed by and construed in accordance with the laws of your local jurisdiction. Any disputes arising from or related to the use of AirMCP shall be resolved in the courts of your local jurisdiction.

---

## Contact

For questions about these terms, open an issue on the [AirMCP GitHub repository](https://github.com/heznpc/airmcp) or contact the developer directly.
