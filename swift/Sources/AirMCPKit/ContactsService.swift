// AirMCPKit — Contacts service shared between macOS and iOS.
// Handles contact CRUD and group operations via native Contacts framework.

import Contacts
import Foundation

public struct ContactsService: Sendable {
    public init() {}

    // MARK: - Authorization helper

    private func authorizedStore() throws -> CNContactStore {
        let store = CNContactStore()
        let status = CNContactStore.authorizationStatus(for: .contacts)
        switch status {
        case .authorized:
            return store
        case .notDetermined:
            // Request access synchronously via semaphore (CNContactStore doesn't have async API)
            nonisolated(unsafe) var granted = false
            nonisolated(unsafe) var authError: Error?
            let semaphore = DispatchSemaphore(value: 0)
            store.requestAccess(for: .contacts) { ok, err in
                granted = ok
                authError = err
                semaphore.signal()
            }
            semaphore.wait()
            if let authError { throw AirMCPKitError.permissionDenied("Contacts access denied: \(authError.localizedDescription)") }
            guard granted else { throw AirMCPKitError.permissionDenied("Contacts access denied") }
            return store
        case .denied, .restricted:
            throw AirMCPKitError.permissionDenied("Contacts access denied. Grant access in System Settings > Privacy & Security > Contacts.")
        @unknown default:
            throw AirMCPKitError.permissionDenied("Contacts access status unknown")
        }
    }

    // MARK: - List Contacts

    public func listContacts(_ input: ListContactsInput) throws -> ContactListOutput {
        let store = try authorizedStore()
        let limit = input.limit ?? 100
        let offset = input.offset ?? 0

        let keys: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactIdentifierKey as CNKeyDescriptor,
        ]

        let request = CNContactFetchRequest(keysToFetch: keys)
        request.sortOrder = .givenName

        var allContacts: [ContactSummary] = []
        try store.enumerateContacts(with: request) { contact, _ in
            let name = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)
            let email = contact.emailAddresses.first?.value as String?
            let phone = contact.phoneNumbers.first?.value.stringValue
            allContacts.append(ContactSummary(
                id: contact.identifier,
                name: name,
                email: email,
                phone: phone
            ))
        }

        let total = allContacts.count
        let s = min(offset, total)
        let e = min(s + limit, total)
        let slice = Array(allContacts[s..<e])

        return ContactListOutput(total: total, offset: s, returned: slice.count, contacts: slice)
    }

    // MARK: - Search Contacts

    public func searchContacts(_ input: SearchContactsInput) throws -> ContactSearchOutput {
        let store = try authorizedStore()
        let limit = input.limit ?? 50
        let query = input.query.lowercased()

        let keys: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactIdentifierKey as CNKeyDescriptor,
        ]

        // Phase 1: name predicate search
        let namePredicate = CNContact.predicateForContacts(matchingName: input.query)
        var nameMatched = Set<String>()
        var results: [ContactSearchItem] = []

        let nameContacts = try store.unifiedContacts(matching: namePredicate, keysToFetch: keys)
        for contact in nameContacts where results.count < limit {
            let name = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)
            let org = contact.organizationName.isEmpty ? nil : contact.organizationName
            results.append(ContactSearchItem(
                id: contact.identifier,
                name: name,
                organization: org,
                email: contact.emailAddresses.first?.value as String?,
                phone: contact.phoneNumbers.first?.value.stringValue,
                matchedField: "name"
            ))
            nameMatched.insert(contact.identifier)
        }

        // Phase 2: enumerate all and check org, email, phone
        if results.count < limit {
            let fetchRequest = CNContactFetchRequest(keysToFetch: keys)
            try store.enumerateContacts(with: fetchRequest) { contact, stop in
                guard results.count < limit else { stop.pointee = true; return }
                guard !nameMatched.contains(contact.identifier) else { return }

                let org = contact.organizationName.isEmpty ? nil : contact.organizationName
                let orgMatch = org?.lowercased().contains(query) ?? false
                let emailMatch = contact.emailAddresses.contains { ($0.value as String).lowercased().contains(query) }
                let phoneMatch = contact.phoneNumbers.contains { $0.value.stringValue.contains(query) }

                if orgMatch || emailMatch || phoneMatch {
                    let name = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)
                    let matchedField = orgMatch ? "organization" : emailMatch ? "email" : "phone"
                    results.append(ContactSearchItem(
                        id: contact.identifier,
                        name: name,
                        organization: org,
                        email: contact.emailAddresses.first?.value as String?,
                        phone: contact.phoneNumbers.first?.value.stringValue,
                        matchedField: matchedField
                    ))
                }
            }
        }

        return ContactSearchOutput(total: results.count, returned: results.count, contacts: results)
    }

    // MARK: - Read Contact

    public func readContact(_ input: ReadContactInput) throws -> ContactDetail {
        let store = try authorizedStore()
        let keys: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactPostalAddressesKey as CNKeyDescriptor,
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactJobTitleKey as CNKeyDescriptor,
            CNContactDepartmentNameKey as CNKeyDescriptor,
            CNContactNoteKey as CNKeyDescriptor,
            CNContactDatesKey as CNKeyDescriptor,
            CNContactIdentifierKey as CNKeyDescriptor,
        ]

        let contact = try store.unifiedContact(withIdentifier: input.id, keysToFetch: keys)
        let name = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)

        let emails = contact.emailAddresses.map { labeled in
            ContactLabeledValue(value: labeled.value as String, label: CNLabeledValue<NSString>.localizedString(forLabel: labeled.label ?? "other"))
        }
        let phones = contact.phoneNumbers.map { labeled in
            ContactLabeledValue(value: labeled.value.stringValue, label: CNLabeledValue<CNPhoneNumber>.localizedString(forLabel: labeled.label ?? "other"))
        }
        let addresses = contact.postalAddresses.map { labeled in
            let addr = labeled.value
            return ContactAddress(
                street: addr.street,
                city: addr.city,
                state: addr.state,
                zip: addr.postalCode,
                country: addr.country,
                label: CNLabeledValue<CNPostalAddress>.localizedString(forLabel: labeled.label ?? "other")
            )
        }

        // CNContact doesn't expose creation/modification dates directly;
        // the JXA script does, but CNContact API doesn't have these properties.
        // We omit them rather than returning wrong data.

        return ContactDetail(
            id: contact.identifier,
            name: name,
            firstName: contact.givenName,
            lastName: contact.familyName,
            organization: contact.organizationName.isEmpty ? nil : contact.organizationName,
            jobTitle: contact.jobTitle.isEmpty ? nil : contact.jobTitle,
            department: contact.departmentName.isEmpty ? nil : contact.departmentName,
            note: contact.note.isEmpty ? nil : contact.note,
            emails: emails,
            phones: phones,
            addresses: addresses
        )
    }

    // MARK: - Create Contact

    public func createContact(_ input: CreateContactInput) throws -> ContactMutationOutput {
        let store = try authorizedStore()
        let contact = CNMutableContact()
        contact.givenName = input.firstName
        contact.familyName = input.lastName

        if let org = input.organization { contact.organizationName = org }
        if let title = input.jobTitle { contact.jobTitle = title }
        if let note = input.note { contact.note = note }

        if let email = input.email {
            contact.emailAddresses = [CNLabeledValue(label: CNLabelWork, value: email as NSString)]
        }
        if let phone = input.phone {
            contact.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: phone))]
        }

        let saveRequest = CNSaveRequest()
        saveRequest.add(contact, toContainerWithIdentifier: nil)
        try store.execute(saveRequest)

        let name = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)
        return ContactMutationOutput(id: contact.identifier, name: name)
    }

    // MARK: - Update Contact

    public func updateContact(_ input: UpdateContactInput) throws -> ContactMutationOutput {
        let store = try authorizedStore()
        let keys: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactJobTitleKey as CNKeyDescriptor,
            CNContactNoteKey as CNKeyDescriptor,
            CNContactIdentifierKey as CNKeyDescriptor,
        ]

        let contact = try store.unifiedContact(withIdentifier: input.id, keysToFetch: keys)
        let mutable = contact.mutableCopy() as! CNMutableContact

        if let firstName = input.firstName { mutable.givenName = firstName }
        if let lastName = input.lastName { mutable.familyName = lastName }
        if let org = input.organization { mutable.organizationName = org }
        if let title = input.jobTitle { mutable.jobTitle = title }
        if let note = input.note { mutable.note = note }

        let saveRequest = CNSaveRequest()
        saveRequest.update(mutable)
        try store.execute(saveRequest)

        let name = "\(mutable.givenName) \(mutable.familyName)".trimmingCharacters(in: .whitespaces)
        return ContactMutationOutput(id: mutable.identifier, name: name)
    }

    // MARK: - Delete Contact

    public func deleteContact(_ input: DeleteContactInput) throws -> ContactDeleteOutput {
        let store = try authorizedStore()
        let keys: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactIdentifierKey as CNKeyDescriptor,
        ]

        let contact = try store.unifiedContact(withIdentifier: input.id, keysToFetch: keys)
        let name = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)
        let mutable = contact.mutableCopy() as! CNMutableContact

        let saveRequest = CNSaveRequest()
        saveRequest.delete(mutable)
        try store.execute(saveRequest)

        return ContactDeleteOutput(deleted: true, name: name)
    }

    // MARK: - List Groups

    public func listGroups() throws -> [ContactGroupInfo] {
        let store = try authorizedStore()
        let groups = try store.groups(matching: nil)
        return groups.map { group in
            ContactGroupInfo(id: group.identifier, name: group.name)
        }
    }

    // MARK: - Add Contact Email

    public func addContactEmail(_ input: AddContactEmailInput) throws -> ContactEmailAddedOutput {
        let store = try authorizedStore()
        let keys: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactIdentifierKey as CNKeyDescriptor,
        ]

        let contact = try store.unifiedContact(withIdentifier: input.id, keysToFetch: keys)
        let mutable = contact.mutableCopy() as! CNMutableContact

        let cnLabel = contactLabel(from: input.label ?? "work")
        let newEmail = CNLabeledValue(label: cnLabel, value: input.email as NSString)
        mutable.emailAddresses.append(newEmail)

        let saveRequest = CNSaveRequest()
        saveRequest.update(mutable)
        try store.execute(saveRequest)

        let name = "\(mutable.givenName) \(mutable.familyName)".trimmingCharacters(in: .whitespaces)
        return ContactEmailAddedOutput(id: mutable.identifier, name: name, addedEmail: input.email)
    }

    // MARK: - Add Contact Phone

    public func addContactPhone(_ input: AddContactPhoneInput) throws -> ContactPhoneAddedOutput {
        let store = try authorizedStore()
        let keys: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactIdentifierKey as CNKeyDescriptor,
        ]

        let contact = try store.unifiedContact(withIdentifier: input.id, keysToFetch: keys)
        let mutable = contact.mutableCopy() as! CNMutableContact

        let cnLabel = phoneLabel(from: input.label ?? "mobile")
        let newPhone = CNLabeledValue(label: cnLabel, value: CNPhoneNumber(stringValue: input.phone))
        mutable.phoneNumbers.append(newPhone)

        let saveRequest = CNSaveRequest()
        saveRequest.update(mutable)
        try store.execute(saveRequest)

        let name = "\(mutable.givenName) \(mutable.familyName)".trimmingCharacters(in: .whitespaces)
        return ContactPhoneAddedOutput(id: mutable.identifier, name: name, addedPhone: input.phone)
    }

    // MARK: - List Group Members

    public func listGroupMembers(_ input: ListGroupMembersInput) throws -> ContactGroupMembersOutput {
        let store = try authorizedStore()
        let limit = input.limit ?? 100
        let offset = input.offset ?? 0

        // Find the group by name
        let groups = try store.groups(matching: nil)
        guard let group = groups.first(where: { $0.name == input.groupName }) else {
            throw AirMCPKitError.notFound("Group not found: \(input.groupName)")
        }

        let keys: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactIdentifierKey as CNKeyDescriptor,
        ]

        let predicate = CNContact.predicateForContactsInGroup(withIdentifier: group.identifier)
        let contacts = try store.unifiedContacts(matching: predicate, keysToFetch: keys)

        let total = contacts.count
        let s = min(offset, total)
        let e = min(s + limit, total)
        let slice = contacts[s..<e]

        let items = slice.map { contact in
            ContactSummary(
                id: contact.identifier,
                name: "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces),
                email: contact.emailAddresses.first?.value as String?,
                phone: contact.phoneNumbers.first?.value.stringValue
            )
        }

        return ContactGroupMembersOutput(group: input.groupName, total: total, returned: items.count, contacts: items)
    }

    // MARK: - Label helpers

    private func contactLabel(from label: String) -> String {
        switch label.lowercased() {
        case "home": return CNLabelHome
        case "work": return CNLabelWork
        case "school": return CNLabelSchool
        case "other": return CNLabelOther
        default: return CNLabelOther
        }
    }

    private func phoneLabel(from label: String) -> String {
        switch label.lowercased() {
        case "home": return CNLabelHome
        case "work": return CNLabelWork
        case "mobile": return CNLabelPhoneNumberMobile
        case "main": return CNLabelPhoneNumberMain
        case "iphone": return CNLabelPhoneNumberiPhone
        case "other": return CNLabelOther
        default: return CNLabelOther
        }
    }
}
