import Foundation
import EventKit
import Photos
import NaturalLanguage
import Accelerate
import CoreLocation
import CoreBluetooth
import Contacts
import Vision
import CoreSpotlight
import AppKit
import AirMCPKit

#if canImport(ImagePlayground)
import ImagePlayground
#endif

// AirMcpBridge CLI — thin wrapper around Apple frameworks.
// Supports two modes:
//   Single-shot: AirMcpBridge <command>       (reads JSON from stdin, writes result, exits)
//   Persistent:  AirMcpBridge --persistent    (newline-delimited JSON-RPC, keeps process alive)

#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - Persistent mode state

var persistentMode = false
var currentRequestId: String? = nil

// MARK: - Shared types

struct Input: Decodable {
    let text: String
    let tone: String?
}

struct Output: Encodable {
    let output: String
}

// MARK: - Foundation Models input/output types (bridge-local)

struct GenerateStructuredInput: Decodable {
    let prompt: String
    let systemInstruction: String?
    let schema: [String: SchemaProperty]?
}

struct SchemaProperty: Decodable {
    let type: String
    let description: String?
}

struct TagContentInput: Decodable {
    let text: String
    let tags: [String]
}

struct AiChatInput: Decodable {
    let sessionName: String
    let message: String
    let systemInstruction: String?
}

let MAX_STDIN_SIZE = 50 * 1024 * 1024 // 50 MB

// MARK: - I/O helpers

func readStdin() -> Data {
    var data = Data()
    while let line = readLine(strippingNewline: false) {
        data.append(Data(line.utf8))
        if data.count > MAX_STDIN_SIZE {
            writeError("stdin too large (>\(MAX_STDIN_SIZE / 1024 / 1024)MB)")
            return Data()
        }
    }
    return data
}

func writeJSON<T: Encodable>(_ value: T) throws {
    let data = try JSONEncoder().encode(value)
    if persistentMode, let id = currentRequestId {
        guard let resultObj = try? JSONSerialization.jsonObject(with: data) else {
            writeError("Failed to serialize result")
            return
        }
        let wrapper: [String: Any] = ["id": id, "result": resultObj]
        let wrappedData = try JSONSerialization.data(withJSONObject: wrapper, options: [.sortedKeys])
        FileHandle.standardOutput.write(wrappedData)
    } else {
        FileHandle.standardOutput.write(data)
    }
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func writeOutput(_ output: Output) throws {
    try writeJSON(output)
}

/// Write a raw JSON Data blob, wrapping with request ID in persistent mode.
func writeRawJSON(_ data: Data) {
    if persistentMode, let id = currentRequestId {
        if let resultObj = try? JSONSerialization.jsonObject(with: data) {
            let wrapper: [String: Any] = ["id": id, "result": resultObj]
            if let wrappedData = try? JSONSerialization.data(withJSONObject: wrapper, options: [.sortedKeys]) {
                FileHandle.standardOutput.write(wrappedData)
                FileHandle.standardOutput.write(Data("\n".utf8))
                return
            }
        }
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func writeError(_ message: String) {
    if persistentMode {
        let resp: [String: Any] = ["id": currentRequestId ?? "", "error": message]
        if let data = try? JSONSerialization.data(withJSONObject: resp, options: [.sortedKeys]) {
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
        }
        return // Don't exit in persistent mode
    }
    let error = ["error": message]
    if let data = try? JSONSerialization.data(withJSONObject: error) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
    exit(1)
}

// MARK: - Bridge-local output types (not yet in AirMCPKit)

struct ClassifyImageOutput: Encodable { let labels: [ImageLabel]; let total: Int }
struct PhotoImportOutput: Encodable { let imported: Bool; let identifier: String? }
struct PhotoDeleteOutput: Encodable { let deleted: Int; let identifiers: [String] }
struct EmbedBatchOutput: Encodable { let vectors: [[Double]]; let dimension: Int; let count: Int }
struct GenerateImageInput: Decodable { let prompt: String; let outputPath: String? }
struct GenerateImageOutput: Encodable { let generated: Bool; let path: String }
struct SpotlightItem: Decodable { let id: String; let title: String; let content: String; let source: String }
struct SpotlightIndexInput: Decodable { let items: [SpotlightItem] }
struct SpotlightIndexOutput: Encodable { let indexed: Int; let success: Bool }
struct ScanDocumentInput: Decodable { let imagePath: String }
struct DocumentElement: Encodable { let type: String; let text: String; let confidence: Double }
struct ScanDocumentOutput: Encodable { let elements: [DocumentElement]; let total: Int }
struct LocationPermissionOutput: Encodable { let status: String; let authorized: Bool }

private let embeddingService = EmbeddingService()

// MARK: - Foundation Models guard helper

#if canImport(FoundationModels)
/// Execute a closure that requires Foundation Models, with standardized error handling.
@available(macOS 26, iOS 26, *)
func runFoundationModels(_ body: () async throws -> Void) async {
    do { try await body() }
    catch { writeError("Foundation Models error: \(error.localizedDescription)") }
}
#endif

// MARK: - Command dispatcher

func handleCommand(command: String, stdinData: Data) async {

switch command {

// --- EventKit: Calendar CRUD (delegated to AirMCPKit) ---
case "list-calendars":
    do {
        let result = try await EventKitService().listCalendars()
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "list-events":
    guard let input = try? JSONDecoder().decode(ListEventsInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected ListEventsInput.")
        return
    }
    do {
        let result = try await EventKitService().listEvents(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "read-event":
    guard let input = try? JSONDecoder().decode(ReadEventInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected ReadEventInput.")
        return
    }
    do {
        let result = try await EventKitService().readEvent(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "create-event":
    guard let input = try? JSONDecoder().decode(CreateEventInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected CreateEventInput.")
        return
    }
    do {
        let result = try await EventKitService().createEvent(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "update-event":
    guard let input = try? JSONDecoder().decode(UpdateEventInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected UpdateEventInput.")
        return
    }
    do {
        let result = try await EventKitService().updateEvent(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "delete-event":
    guard let input = try? JSONDecoder().decode(DeleteEventInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected DeleteEventInput.")
        return
    }
    do {
        let result = try await EventKitService().deleteEvent(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "search-events":
    guard let input = try? JSONDecoder().decode(SearchEventsInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected SearchEventsInput.")
        return
    }
    do {
        let result = try await EventKitService().searchEvents(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "get-upcoming-events":
    let input = (try? JSONDecoder().decode(UpcomingEventsInput.self, from: stdinData)) ?? UpcomingEventsInput(limit: nil)
    do {
        let result = try await EventKitService().getUpcomingEvents(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "today-events":
    do {
        let result = try await EventKitService().todayEvents()
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

// --- EventKit: Recurring Events (delegated to AirMCPKit) ---
case "create-recurring-event":
    guard let eventInput = try? JSONDecoder().decode(RecurringEventInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected RecurringEventInput.")
        return
    }
    do {
        let result = try await EventKitService().createRecurringEvent(eventInput)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

// --- EventKit: Reminder CRUD (delegated to AirMCPKit) ---
case "list-reminder-lists":
    do {
        let result = try await EventKitService().listReminderLists()
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "list-reminders":
    let inputData = stdinData.isEmpty ? Data("{}".utf8) : stdinData
    guard let input = try? JSONDecoder().decode(ListRemindersInput.self, from: inputData) else {
        writeError("Invalid JSON. Expected ListRemindersInput.")
        return
    }
    do {
        let result = try await EventKitService().listReminders(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "read-reminder":
    guard let input = try? JSONDecoder().decode(ReadReminderInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected ReadReminderInput.")
        return
    }
    do {
        let result = try await EventKitService().readReminder(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "create-reminder":
    guard let input = try? JSONDecoder().decode(CreateReminderInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected CreateReminderInput.")
        return
    }
    do {
        let result = try await EventKitService().createReminder(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "update-reminder":
    guard let input = try? JSONDecoder().decode(UpdateReminderInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected UpdateReminderInput.")
        return
    }
    do {
        let result = try await EventKitService().updateReminder(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "complete-reminder":
    guard let input = try? JSONDecoder().decode(CompleteReminderInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected CompleteReminderInput.")
        return
    }
    do {
        let result = try await EventKitService().completeReminder(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "delete-reminder":
    guard let input = try? JSONDecoder().decode(DeleteReminderInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected DeleteReminderInput.")
        return
    }
    do {
        let result = try await EventKitService().deleteReminder(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "search-reminders":
    guard let input = try? JSONDecoder().decode(SearchRemindersInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected SearchRemindersInput.")
        return
    }
    do {
        let result = try await EventKitService().searchReminders(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "create-reminder-list":
    guard let input = try? JSONDecoder().decode(CreateReminderListInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected CreateReminderListInput.")
        return
    }
    do {
        let result = try await EventKitService().createReminderList(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "delete-reminder-list":
    guard let input = try? JSONDecoder().decode(DeleteReminderListInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected DeleteReminderListInput.")
        return
    }
    do {
        let result = try await EventKitService().deleteReminderList(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

// --- EventKit: Recurring Reminders (delegated to AirMCPKit) ---
case "create-recurring-reminder":
    guard let remInput = try? JSONDecoder().decode(RecurringReminderInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected RecurringReminderInput.")
        return
    }
    do {
        let result = try await EventKitService().createRecurringReminder(remInput)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

// --- PhotoKit: Advanced Query ---
case "query-photos":
    guard let queryInput = try? JSONDecoder().decode(PhotoQueryInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected PhotoQueryInput.")
        return
    }

    let fetchOptions = PHFetchOptions()
    var predicates: [NSPredicate] = []

    if let mediaType = queryInput.mediaType {
        let type: PHAssetMediaType = mediaType == "video" ? .video : mediaType == "audio" ? .audio : .image
        predicates.append(NSPredicate(format: "mediaType = %d", type.rawValue))
    }
    if let startStr = queryInput.startDate, let start = parseISO8601(startStr) {
        predicates.append(NSPredicate(format: "creationDate >= %@", start as NSDate))
    }
    if let endStr = queryInput.endDate, let end = parseISO8601(endStr) {
        predicates.append(NSPredicate(format: "creationDate <= %@", end as NSDate))
    }
    if let fav = queryInput.favorites, fav {
        predicates.append(NSPredicate(format: "isFavorite = YES"))
    }

    if !predicates.isEmpty {
        fetchOptions.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
    }
    fetchOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    let limit = queryInput.limit ?? 50
    fetchOptions.fetchLimit = limit

    let assets = PHAsset.fetchAssets(with: fetchOptions)
    var photos: [PhotoInfo] = []
    assets.enumerateObjects { asset, _, _ in
        let typeStr = asset.mediaType == .video ? "video" : asset.mediaType == .audio ? "audio" : "image"
        photos.append(PhotoInfo(
            identifier: asset.localIdentifier,
            filename: PHAssetResource.assetResources(for: asset).first?.originalFilename,
            creationDate: asset.creationDate.map { formatISO8601($0) },
            mediaType: typeStr,
            isFavorite: asset.isFavorite,
            width: asset.pixelWidth,
            height: asset.pixelHeight
        ))
    }
    let queryOutput = PhotoQueryOutput(photos: photos, total: photos.count)
    do { try writeJSON(queryOutput) } catch { writeError("Photo query error: \(error.localizedDescription)") }

// --- Vision: Classify Image (delegated to AirMCPKit) ---
case "classify-image":
    guard let classInput = try? JSONDecoder().decode(ClassifyImageInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected ClassifyImageInput.")
        return
    }
    do {
        let labels = try VisionService().classifyImage(path: classInput.imagePath, maxResults: classInput.maxResults ?? 10)
        let output = ClassifyImageOutput(labels: labels, total: labels.count)
        try writeJSON(output)
    } catch {
        writeError("Vision classify error: \(error.localizedDescription)")
    }

// --- PhotoKit: Import ---
case "import-photo":
    guard let photoInput = try? JSONDecoder().decode(ImportPhotoInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected ImportPhotoInput.")
        return
    }

    let fileURL = URL(fileURLWithPath: photoInput.filePath)
    guard FileManager.default.fileExists(atPath: photoInput.filePath) else {
        writeError("File not found: \(photoInput.filePath)")
        return
    }

    do {
        var localId: String? = nil
        try await PHPhotoLibrary.shared().performChanges {
            let request = PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: fileURL)
            localId = request?.placeholderForCreatedAsset?.localIdentifier

            if let albumName = photoInput.albumName {
                let fetchOptions = PHFetchOptions()
                fetchOptions.predicate = NSPredicate(format: "title = %@", albumName)
                let albums = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: fetchOptions)
                if let album = albums.firstObject, let placeholder = request?.placeholderForCreatedAsset {
                    let albumRequest = PHAssetCollectionChangeRequest(for: album)
                    albumRequest?.addAssets([placeholder] as NSArray)
                }
            }
        }

        let output = PhotoImportOutput(imported: true, identifier: localId)
        try writeJSON(output)
    } catch {
        writeError("Photo import error: \(error.localizedDescription)")
    }

// --- PhotoKit: Delete ---
case "delete-photos":
    guard let deleteInput = try? JSONDecoder().decode(DeletePhotosInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected DeletePhotosInput.")
        return
    }

    let assets = PHAsset.fetchAssets(withLocalIdentifiers: deleteInput.identifiers, options: nil)
    var toDelete: [PHAsset] = []
    assets.enumerateObjects { asset, _, _ in
        toDelete.append(asset)
    }

    guard !toDelete.isEmpty else {
        writeError("No matching photos found")
        return
    }

    do {
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetChangeRequest.deleteAssets(toDelete as NSArray)
        }

        let deletedIds = toDelete.map { $0.localIdentifier }
        let output = PhotoDeleteOutput(deleted: deletedIds.count, identifiers: deletedIds)
        try writeJSON(output)
    } catch {
        writeError("Photo delete error: \(error.localizedDescription)")
    }

// --- PhotoKit: List Albums ---
case "list-albums":
    let fetchOptions = PHFetchOptions()
    fetchOptions.sortDescriptors = [NSSortDescriptor(key: "localizedTitle", ascending: true)]
    let collections = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: fetchOptions)
    var albums: [AlbumInfo] = []
    collections.enumerateObjects { collection, _, _ in
        let countOptions = PHFetchOptions()
        let assetCount = PHAsset.fetchAssets(in: collection, options: countOptions).count
        albums.append(AlbumInfo(
            id: collection.localIdentifier,
            name: collection.localizedTitle ?? "",
            count: assetCount
        ))
    }
    do { try writeJSON(albums) } catch { writeError("List albums error: \(error.localizedDescription)") }

// --- PhotoKit: List Photos ---
case "list-photos":
    guard let listInput = try? JSONDecoder().decode(ListPhotosInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected ListPhotosInput.")
        return
    }

    let limit = listInput.limit ?? 50
    let offset = listInput.offset ?? 0

    let assets: PHFetchResult<PHAsset>
    if let albumName = listInput.albumName {
        let albumOptions = PHFetchOptions()
        albumOptions.predicate = NSPredicate(format: "title = %@", albumName)
        let collections = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: albumOptions)
        guard let album = collections.firstObject else {
            writeError("Album not found: \(albumName)")
            return
        }
        let assetOptions = PHFetchOptions()
        assetOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        assets = PHAsset.fetchAssets(in: album, options: assetOptions)
    } else {
        let assetOptions = PHFetchOptions()
        assetOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        assets = PHAsset.fetchAssets(with: assetOptions)
    }

    let total = assets.count
    let start = min(offset, total)
    let end = min(start + limit, total)
    var photos: [PhotoListItem] = []
    for i in start..<end {
        let asset = assets.object(at: i)
        photos.append(PhotoListItem(
            id: asset.localIdentifier,
            filename: PHAssetResource.assetResources(for: asset).first?.originalFilename,
            name: nil,
            date: asset.creationDate.map { formatISO8601($0) },
            width: asset.pixelWidth,
            height: asset.pixelHeight,
            favorite: asset.isFavorite
        ))
    }
    let listOutput = ListPhotosOutput(total: total, offset: start, returned: photos.count, photos: photos)
    do { try writeJSON(listOutput) } catch { writeError("List photos error: \(error.localizedDescription)") }

// --- PhotoKit: Search Photos ---
case "search-photos":
    guard let searchInput = try? JSONDecoder().decode(SearchPhotosInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected SearchPhotosInput.")
        return
    }

    let searchLimit = searchInput.limit ?? 30
    let query = searchInput.query.lowercased()

    let fetchOpts = PHFetchOptions()
    fetchOpts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    let allAssets = PHAsset.fetchAssets(with: fetchOpts)
    var searchResults: [SearchPhotoItem] = []
    allAssets.enumerateObjects { asset, _, stop in
        if searchResults.count >= searchLimit {
            stop.pointee = true
            return
        }
        let resources = PHAssetResource.assetResources(for: asset)
        let filename = resources.first?.originalFilename ?? ""
        if filename.lowercased().contains(query) {
            searchResults.append(SearchPhotoItem(
                id: asset.localIdentifier,
                filename: filename,
                name: nil,
                date: asset.creationDate.map { formatISO8601($0) },
                favorite: asset.isFavorite,
                description: nil
            ))
        }
    }
    let searchOutput = SearchPhotosOutput(total: searchResults.count, photos: searchResults)
    do { try writeJSON(searchOutput) } catch { writeError("Search photos error: \(error.localizedDescription)") }

// --- PhotoKit: Get Photo Info ---
case "get-photo-info":
    guard let infoInput = try? JSONDecoder().decode(GetPhotoInfoInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected GetPhotoInfoInput.")
        return
    }

    let infoAssets = PHAsset.fetchAssets(withLocalIdentifiers: [infoInput.id], options: nil)
    guard let asset = infoAssets.firstObject else {
        writeError("Photo not found: \(infoInput.id)")
        return
    }

    let resources = PHAssetResource.assetResources(for: asset)
    let loc = asset.location
    let locationArr: [Double]? = loc.map { [$0.coordinate.latitude, $0.coordinate.longitude] }

    let infoOutput = PhotoDetailOutput(
        id: asset.localIdentifier,
        filename: resources.first?.originalFilename,
        name: nil,
        description: nil,
        date: asset.creationDate.map { formatISO8601($0) },
        width: asset.pixelWidth,
        height: asset.pixelHeight,
        altitude: loc?.altitude,
        location: locationArr,
        favorite: asset.isFavorite,
        keywords: nil
    )
    do { try writeJSON(infoOutput) } catch { writeError("Photo info error: \(error.localizedDescription)") }

// --- PhotoKit: List Favorites ---
case "list-favorites":
    guard let favInput = (try? JSONDecoder().decode(ListFavoritesInput.self, from: stdinData)) ?? ListFavoritesInput(limit: nil, offset: nil) as ListFavoritesInput? else {
        writeError("Invalid JSON. Expected ListFavoritesInput.")
        return
    }

    let favLimit = favInput.limit ?? 50
    let favOffset = favInput.offset ?? 0
    let favOptions = PHFetchOptions()
    favOptions.predicate = NSPredicate(format: "isFavorite = YES")
    favOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    let favAssets = PHAsset.fetchAssets(with: favOptions)
    let favTotal = favAssets.count
    let favStart = min(favOffset, favTotal)
    let favEnd = min(favStart + favLimit, favTotal)
    var favPhotos: [PhotoListItem] = []
    for i in favStart..<favEnd {
        let asset = favAssets.object(at: i)
        favPhotos.append(PhotoListItem(
            id: asset.localIdentifier,
            filename: PHAssetResource.assetResources(for: asset).first?.originalFilename,
            name: nil,
            date: asset.creationDate.map { formatISO8601($0) },
            width: asset.pixelWidth,
            height: asset.pixelHeight,
            favorite: true
        ))
    }
    let favOutput = ListFavoritesOutput(total: favTotal, returned: favPhotos.count, photos: favPhotos)
    do { try writeJSON(favOutput) } catch { writeError("List favorites error: \(error.localizedDescription)") }

// --- PhotoKit: Create Album ---
case "create-album":
    guard let createInput = try? JSONDecoder().decode(CreateAlbumInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected CreateAlbumInput.")
        return
    }

    do {
        var albumId: String? = nil
        try await PHPhotoLibrary.shared().performChanges {
            let request = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: createInput.name)
            albumId = request.placeholderForCreatedAssetCollection.localIdentifier
        }

        guard let createdId = albumId else {
            writeError("Failed to create album")
            return
        }

        let createOutput = CreateAlbumOutput(id: createdId, name: createInput.name)
        try writeJSON(createOutput)
    } catch {
        writeError("Create album error: \(error.localizedDescription)")
    }

// --- PhotoKit: Add to Album ---
case "add-to-album":
    guard let addInput = try? JSONDecoder().decode(AddToAlbumInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected AddToAlbumInput.")
        return
    }

    let albumFetchOpts = PHFetchOptions()
    albumFetchOpts.predicate = NSPredicate(format: "title = %@", addInput.albumName)
    let albumResults = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: albumFetchOpts)
    guard let targetAlbum = albumResults.firstObject else {
        writeError("Album not found: \(addInput.albumName)")
        return
    }

    let assetsToAdd = PHAsset.fetchAssets(withLocalIdentifiers: addInput.photoIds, options: nil)
    guard assetsToAdd.count > 0 else {
        writeError("No matching photos found")
        return
    }

    var addedAssets: [PHAsset] = []
    assetsToAdd.enumerateObjects { asset, _, _ in
        addedAssets.append(asset)
    }

    do {
        try await PHPhotoLibrary.shared().performChanges {
            let albumChangeRequest = PHAssetCollectionChangeRequest(for: targetAlbum)
            albumChangeRequest?.addAssets(addedAssets as NSArray)
        }

        let addOutput = AddToAlbumOutput(added: addedAssets.count, album: addInput.albumName)
        try writeJSON(addOutput)
    } catch {
        writeError("Add to album error: \(error.localizedDescription)")
    }

// --- NLContextualEmbedding: embed text ---
case "embed-text":
    guard let input = try? JSONDecoder().decode(EmbedTextInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected EmbedTextInput.")
        return
    }
    let lang = embeddingService.nlLanguageFromCode(input.language) ?? embeddingService.detectLanguage(input.text)
    do {
        let vector = try embeddingService.embedText(input.text, language: lang)
        let output = EmbedTextOutput(vector: vector, dimension: vector.count)
        try writeJSON(output)
    } catch {
        writeError("Embedding failed: \(error.localizedDescription)")
    }

case "embed-batch":
    guard let input = try? JSONDecoder().decode(EmbedBatchInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected EmbedBatchInput.")
        return
    }
    do {
        let lang = input.language.flatMap { embeddingService.nlLanguageFromCode($0) }
        let vectors = try embeddingService.embedBatch(input.texts, language: lang)
        let dim = vectors.first?.count ?? 0
        let output = EmbedBatchOutput(vectors: vectors, dimension: dim, count: vectors.count)
        try writeJSON(output)
    } catch {
        writeError("Batch embedding failed: \(error.localizedDescription)")
    }

// --- Apple Intelligence: summarize, rewrite, proofread ---
case "summarize", "rewrite", "proofread":
    guard let input = try? JSONDecoder().decode(Input.self, from: stdinData) else {
        writeError("Invalid JSON input. Expected: {\"text\": \"...\", \"tone\": \"...\"}")
        return
    }
    #if canImport(FoundationModels)
    if #available(macOS 26, *) { await runFoundationModels {
        let session = LanguageModelSession()
        let prompt: String
        switch command {
        case "summarize": prompt = "Summarize the following text concisely:\n\n\(input.text)"
        case "rewrite":   prompt = "Rewrite the following text in a \(input.tone ?? "professional") tone:\n\n\(input.text)"
        case "proofread": prompt = "Proofread and correct any grammar or spelling errors in the following text. Return only the corrected text:\n\n\(input.text)"
        default: return
        }
        let result = try await session.respond(to: prompt)
        try writeOutput(Output(output: result.content))
    } } else { writeError("\(command) requires macOS 26+.") }
    #else
    writeError("\(command) requires macOS 26+ with Apple Silicon.")
    #endif

// --- Foundation Models: generate-text ---
case "generate-text":
    guard let genInput = try? JSONDecoder().decode(GenerateTextInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected GenerateTextInput.")
        return
    }
    #if canImport(FoundationModels)
    if #available(macOS 26, *) { await runFoundationModels {
        let session = LanguageModelSession(instructions: genInput.systemInstruction ?? "You are a helpful assistant.")
        let result = try await session.respond(to: genInput.prompt)
        try writeOutput(Output(output: result.content))
    } } else { writeError("\(command) requires macOS 26+.") }
    #else
    writeError("generate-text requires macOS 26+ with Apple Silicon.")
    #endif

// --- Foundation Models: generate-structured ---
case "generate-structured":
    guard let structInput = try? JSONDecoder().decode(GenerateStructuredInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected GenerateStructuredInput.")
        return
    }
    #if canImport(FoundationModels)
    if #available(macOS 26, *) { await runFoundationModels {
        let session = LanguageModelSession(instructions: structInput.systemInstruction ?? "You are a helpful assistant. Respond with valid JSON only.")
        let prompt: String
        if let schema = structInput.schema {
            let schemaDesc = schema.map { "\($0.key): \($0.value.type)\($0.value.description.map { " — \($0)" } ?? "")" }.joined(separator: "\n")
            prompt = "\(structInput.prompt)\n\nRespond with a JSON object matching this schema:\n\(schemaDesc)"
        } else {
            prompt = "\(structInput.prompt)\n\nRespond with valid JSON only."
        }
        let result = try await session.respond(to: prompt)
        let content = result.content.trimmingCharacters(in: .whitespacesAndNewlines)
        let validJson = (content.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) }) != nil
        let jsonDict: [String: Any] = ["output": content, "valid_json": validJson]
        let outData = try JSONSerialization.data(withJSONObject: jsonDict, options: [.sortedKeys])
        writeRawJSON(outData)
    } } else { writeError("\(command) requires macOS 26+.") }
    #else
    writeError("generate-structured requires macOS 26+ with Apple Silicon.")
    #endif

// --- Foundation Models: tag-content ---
case "tag-content":
    guard let tagInput = try? JSONDecoder().decode(TagContentInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected TagContentInput.")
        return
    }
    #if canImport(FoundationModels)
    if #available(macOS 26, *) { await runFoundationModels {
        let tagList = tagInput.tags.joined(separator: ", ")
        let session = LanguageModelSession(instructions: "You are a content classification system. Classify text into the provided categories. Respond with ONLY a JSON object mapping each applicable tag to a confidence score between 0.0 and 1.0.")
        let result = try await session.respond(to: "Classify this text into these categories: [\(tagList)]\n\nText: \(tagInput.text)\n\nRespond with a JSON object like {\"tag\": confidence_score} for each applicable tag.")
        let content = result.content.trimmingCharacters(in: .whitespacesAndNewlines)
        let tags = content.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let outDict: [String: Any] = tags != nil ? ["tags": tags!, "text_preview": String(tagInput.text.prefix(100))] : ["output": content, "text_preview": String(tagInput.text.prefix(100))]
        let outData = try JSONSerialization.data(withJSONObject: outDict, options: [.sortedKeys])
        writeRawJSON(outData)
    } } else { writeError("\(command) requires macOS 26+.") }
    #else
    writeError("tag-content requires macOS 26+ with Apple Silicon.")
    #endif

// --- Foundation Models: ai-chat ---
case "ai-chat":
    guard let chatInput = try? JSONDecoder().decode(AiChatInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected AiChatInput.")
        return
    }
    #if canImport(FoundationModels)
    if #available(macOS 26, *) { await runFoundationModels {
        let session = LanguageModelSession(instructions: chatInput.systemInstruction ?? "You are a helpful on-device AI assistant.")
        let result = try await session.respond(to: chatInput.message)
        let outDict: [String: Any] = ["sessionName": chatInput.sessionName, "response": result.content]
        let outData = try JSONSerialization.data(withJSONObject: outDict, options: [.sortedKeys])
        writeRawJSON(outData)
    } } else { writeError("\(command) requires macOS 26+.") }
    #else
    writeError("ai-chat requires macOS 26+ with Apple Silicon.")
    #endif

// --- Foundation Models: ai-status ---
case "ai-status":
    let processInfo = ProcessInfo.processInfo
    let osVersion = processInfo.operatingSystemVersion
    let versionString = "\(osVersion.majorVersion).\(osVersion.minorVersion).\(osVersion.patchVersion)"

    #if arch(arm64)
    let hasAppleSilicon = true
    #else
    let hasAppleSilicon = false
    #endif

    #if canImport(FoundationModels)
    let fmSupported = true
    let available = hasAppleSilicon && osVersion.majorVersion >= 26
    let message: String
    if available {
        message = "Apple Foundation Models are available and ready to use."
    } else if !hasAppleSilicon {
        message = "Apple Foundation Models require Apple Silicon (M1 or later)."
    } else {
        message = "Apple Foundation Models require macOS 26 or later. Current: macOS \(versionString)."
    }
    #else
    let fmSupported = false
    let available = false
    let message = "This binary was compiled without Foundation Models support. Requires macOS 26+ SDK."
    #endif

    let statusOutput = AiStatusOutput(
        available: available,
        message: message,
        macOSVersion: versionString,
        hasAppleSilicon: hasAppleSilicon,
        foundationModelsSupported: fmSupported
    )
    do { try writeJSON(statusOutput) } catch { writeError("AI status error: \(error.localizedDescription)") }

// --- CoreLocation: get current location ---
case "get-location":
    let fetcher = LocationFetcher()
    do {
        let location = try await fetcher.fetch()
        let output = LocationOutput(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            altitude: location.altitude,
            horizontalAccuracy: location.horizontalAccuracy,
            verticalAccuracy: location.verticalAccuracy,
            timestamp: formatISO8601(location.timestamp)
        )
        try writeJSON(output)
    } catch {
        writeError("Location error: \(error.localizedDescription)")
    }

// --- CoreLocation: check permission ---
case "location-permission":
    let status: CLAuthorizationStatus
    if #available(macOS 14.0, *) {
        status = CLLocationManager().authorizationStatus
    } else {
        status = CLLocationManager.authorizationStatus()
    }
    let authorized = status == .authorizedAlways
    let output = LocationPermissionOutput(status: locationStatusString(status), authorized: authorized)
    do { try writeJSON(output) } catch { writeError("Location permission error: \(error.localizedDescription)") }

// --- CoreBluetooth: state ---
case "bluetooth-state":
    let bt = BluetoothManager()
    let state = await bt.initialize()
    let output = BluetoothStateOutput(state: bluetoothStateString(state), powered: state == .poweredOn)
    do { try writeJSON(output) } catch { writeError("Bluetooth state error: \(error.localizedDescription)") }

// --- CoreBluetooth: scan ---
case "scan-bluetooth":
    let scanInput = try? JSONDecoder().decode(BluetoothScanInput.self, from: stdinData)
    let duration = scanInput?.duration ?? 5.0
    let bt = BluetoothManager()
    let devices = await bt.scan(duration: min(max(duration, 1), 30))
    let scanOutput = BluetoothScanOutput(total: devices.count, devices: devices)
    do { try writeJSON(scanOutput) } catch { writeError("Bluetooth scan error: \(error.localizedDescription)") }

// --- CoreBluetooth: connect ---
case "connect-bluetooth":
    guard let connInput = try? JSONDecoder().decode(BluetoothConnectInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected BluetoothConnectInput.")
        return
    }
    let bt = BluetoothManager()
    do {
        let name = try await bt.connect(identifier: connInput.identifier)
        let output = BluetoothConnectOutput(success: true, identifier: connInput.identifier, name: name)
        try writeJSON(output)
    } catch {
        writeError("Bluetooth connect error: \(error.localizedDescription)")
    }

// --- CoreBluetooth: disconnect ---
case "disconnect-bluetooth":
    guard let disconnInput = try? JSONDecoder().decode(BluetoothConnectInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected BluetoothConnectInput.")
        return
    }
    let bt = BluetoothManager()
    do {
        let name = try await bt.disconnect(identifier: disconnInput.identifier)
        let output = BluetoothConnectOutput(success: true, identifier: disconnInput.identifier, name: name)
        try writeJSON(output)
    } catch {
        writeError("Bluetooth disconnect error: \(error.localizedDescription)")
    }

// --- ImageCreator: generate image from text ---
case "generate-image":
    guard let _ = try? JSONDecoder().decode(GenerateImageInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected GenerateImageInput.")
        return
    }
    writeError("generate-image requires rebuilding the Swift bridge with Xcode 26+ SDK. Run: npm run swift-build")

// --- Core Spotlight: index items for Siri/Spotlight discovery ---
case "spotlight-index":
    guard let indexInput = try? JSONDecoder().decode(SpotlightIndexInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected SpotlightIndexInput.")
        return
    }

    let searchableItems = indexInput.items.map { item -> CSSearchableItem in
        let attrs = CSSearchableItemAttributeSet(contentType: .text)
        attrs.title = item.title
        attrs.textContent = item.content
        attrs.contentDescription = "AirMCP \(item.source)"
        attrs.identifier = item.id
        return CSSearchableItem(
            uniqueIdentifier: "airmcp.\(item.source).\(item.id)",
            domainIdentifier: "com.airmcp.\(item.source)",
            attributeSet: attrs
        )
    }

    do {
        try await CSSearchableIndex.default().indexSearchableItems(searchableItems)
        let output = SpotlightIndexOutput(indexed: searchableItems.count, success: true)
        try writeJSON(output)
    } catch {
        writeError("Spotlight indexing error: \(error.localizedDescription)")
    }

// --- Core Spotlight: clear indexed items ---
case "spotlight-clear":
    do {
        let domains = ["com.airmcp.notes", "com.airmcp.calendar", "com.airmcp.reminders", "com.airmcp.mail"]
        try await CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: domains)
        let clearOutput = SpotlightIndexOutput(indexed: 0, success: true)
        try writeJSON(clearOutput)
    } catch {
        writeError("Spotlight clear error: \(error.localizedDescription)")
    }

// --- Vision: scan document from image (delegated to AirMCPKit) ---
case "scan-document":
    guard let scanInput = try? JSONDecoder().decode(ScanDocumentInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected ScanDocumentInput.")
        return
    }

    if #available(macOS 14, iOS 16, *) {
        do {
            let results = try VisionService().scanDocument(path: scanInput.imagePath)
            let elements = results.map { DocumentElement(type: $0.type, text: $0.text, confidence: $0.confidence) }
            let output = ScanDocumentOutput(elements: elements, total: elements.count)
            try writeJSON(output)
        } catch {
            writeError("Vision scan error: \(error.localizedDescription)")
        }
    } else {
        writeError("Document scanning requires macOS 14+.")
    }

// --- Contacts: CRUD + Groups (delegated to AirMCPKit) ---
case "list-contacts":
    let input = (try? JSONDecoder().decode(ListContactsInput.self, from: stdinData)) ?? ListContactsInput(limit: nil, offset: nil)
    do {
        let result = try ContactsService().listContacts(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "search-contacts":
    guard let input = try? JSONDecoder().decode(SearchContactsInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected SearchContactsInput.")
        return
    }
    do {
        let result = try ContactsService().searchContacts(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "read-contact":
    guard let input = try? JSONDecoder().decode(ReadContactInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected ReadContactInput.")
        return
    }
    do {
        let result = try ContactsService().readContact(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "create-contact":
    guard let input = try? JSONDecoder().decode(CreateContactInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected CreateContactInput.")
        return
    }
    do {
        let result = try ContactsService().createContact(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "update-contact":
    guard let input = try? JSONDecoder().decode(UpdateContactInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected UpdateContactInput.")
        return
    }
    do {
        let result = try ContactsService().updateContact(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "delete-contact":
    guard let input = try? JSONDecoder().decode(DeleteContactInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected DeleteContactInput.")
        return
    }
    do {
        let result = try ContactsService().deleteContact(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "list-groups":
    do {
        let result = try ContactsService().listGroups()
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "add-contact-email":
    guard let input = try? JSONDecoder().decode(AddContactEmailInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected AddContactEmailInput.")
        return
    }
    do {
        let result = try ContactsService().addContactEmail(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "add-contact-phone":
    guard let input = try? JSONDecoder().decode(AddContactPhoneInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected AddContactPhoneInput.")
        return
    }
    do {
        let result = try ContactsService().addContactPhone(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

case "list-group-members":
    guard let input = try? JSONDecoder().decode(ListGroupMembersInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected ListGroupMembersInput.")
        return
    }
    do {
        let result = try ContactsService().listGroupMembers(input)
        try writeJSON(result)
    } catch {
        writeError(error.localizedDescription)
    }

// --- Command discovery ---
case "list-commands":
    let commands = [
        "list-commands",
        "get-clipboard",
        "embed-text",
        "embed-batch",
        "summarize",
        "rewrite",
        "proofread",
        "generate-text",
        "generate-structured",
        "tag-content",
        "ai-chat",
        "ai-status",
        "list-calendars",
        "list-events",
        "read-event",
        "create-event",
        "update-event",
        "delete-event",
        "search-events",
        "get-upcoming-events",
        "today-events",
        "create-recurring-event",
        "list-reminder-lists",
        "list-reminders",
        "read-reminder",
        "create-reminder",
        "update-reminder",
        "complete-reminder",
        "delete-reminder",
        "search-reminders",
        "create-reminder-list",
        "delete-reminder-list",
        "create-recurring-reminder",
        "list-albums",
        "list-photos",
        "search-photos",
        "get-photo-info",
        "list-favorites",
        "create-album",
        "add-to-album",
        "query-photos",
        "classify-image",
        "import-photo",
        "delete-photos",
        "get-location",
        "location-permission",
        "bluetooth-state",
        "scan-bluetooth",
        "connect-bluetooth",
        "disconnect-bluetooth",
        "generate-image",
        "spotlight-index",
        "spotlight-clear",
        "scan-document",
        "list-contacts",
        "search-contacts",
        "read-contact",
        "create-contact",
        "update-contact",
        "delete-contact",
        "list-groups",
        "add-contact-email",
        "add-contact-phone",
        "list-group-members",
    ]
    do {
        let data = try JSONSerialization.data(withJSONObject: commands, options: [.sortedKeys])
        writeRawJSON(data)
    } catch {
        writeError("Failed to serialize command list: \(error.localizedDescription)")
    }

// --- System: clipboard ---
case "get-clipboard":
    let pasteboard = NSPasteboard.general
    let content = pasteboard.string(forType: .string) ?? ""
    let maxLen = 5_000_000
    let truncated = content.count > maxLen
    let clipped = truncated ? String(content.prefix(maxLen)) : content
    let output: [String: Any] = [
        "content": clipped,
        "length": clipped.count,
        "truncated": truncated,
    ]
    do {
        let outData = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
        writeRawJSON(outData)
    } catch {
        writeError("Failed to serialize clipboard output: \(error.localizedDescription)")
    }

default:
    writeError("Unknown command: \(command). Use list-commands to see all available commands.")
}

} // end handleCommand

// MARK: - Main

let args = CommandLine.arguments

if args.contains("--persistent") {
    // Persistent mode: read newline-delimited JSON requests, dispatch, respond.
    // Process stays alive — frameworks, models, and caches persist between calls.
    persistentMode = true

    // Signal readiness
    let ready: [String: Any] = ["id": "__ready__", "result": ["status": "ok"]]
    if let data = try? JSONSerialization.data(withJSONObject: ready, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }

    while let line = readLine() {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { continue }

        guard let jsonData = trimmed.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              let id = json["id"] as? String,
              let command = json["command"] as? String else {
            let errResp: [String: Any] = ["id": "", "error": "Invalid request format. Expected {\"id\":\"...\",\"command\":\"...\",\"input\":{...}}"]
            if let data = try? JSONSerialization.data(withJSONObject: errResp, options: [.sortedKeys]) {
                FileHandle.standardOutput.write(data)
                FileHandle.standardOutput.write(Data("\n".utf8))
            }
            continue
        }

        currentRequestId = id

        // Extract "input" field as Data for command-specific decoding
        var inputData = Data()
        if let inputObj = json["input"] {
            inputData = (try? JSONSerialization.data(withJSONObject: inputObj)) ?? Data()
        }

        await handleCommand(command: command, stdinData: inputData)
    }
} else {
    // Single-shot mode (original behavior)
    guard args.count >= 2 else {
        writeError("Usage: AirMcpBridge <command>")
        exit(1)
    }
    let command = args[1]
    let stdinData = readStdin()
    await handleCommand(command: command, stdinData: stdinData)
}
