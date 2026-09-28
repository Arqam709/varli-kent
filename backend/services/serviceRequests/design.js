// "Request this design": turns the ids the app sent into verified, owned data.
//
// ── Nothing the client sends is trusted ──────────────────────────────────
// The app sends at most a board id and a generation id. Every lookup below is
// scoped to `user: <the authenticated user>`, so another customer's board or
// visualization simply does not exist here — and a guessed id, a deleted
// record, an expired visualization and someone else's record all produce the
// SAME answer (DESIGN_NOT_FOUND). Nothing confirms that an id exists.
//
// The relationships are derived from the server's records, not from the
// request: a visualization's board and room photo are the ones stored on the
// DesignGeneration, and if the app also names a board, it must be that one.
//
// ── What a design contributes ────────────────────────────────────────────
//   from a visualization  the snapshot the visualization was actually made
//                         from (DesignGeneration.boardSnapshot — so a board
//                         edited since cannot change what was requested), the
//                         generated image, and the room photo if it still
//                         exists (room photos expire sooner than results)
//   from a board only     the board's current choices; no images

import DesignBoard from '../../models/DesignBoard.js'
import DesignGeneration from '../../models/DesignGeneration.js'
import DesignRoomPhoto from '../../models/DesignRoomPhoto.js'
import { DESIGN_ROOM_TO_REQUEST_ROOM } from '../../config/serviceRequests.js'

export class ServiceRequestDesignError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ServiceRequestDesignError'
    this.code = code
    this.status = 400
  }
}

const notFound = () =>
  new ServiceRequestDesignError('DESIGN_NOT_FOUND', 'This design could not be found in your account.')

/** Only the design fields a request keeps: no ids, no timestamps, no images. */
export const designSnapshotOf = (source) => ({
  version: source.version,
  room: source.room,
  style: source.style,
  wall: { label: source.wall.label, color: source.wall.color },
  floor: { label: source.floor.label, color: source.floor.color },
  materials: (source.materials ?? []).map((material) => ({ name: material.name, color: material.color })),
  lighting: source.lighting,
})

/**
 * @returns {Promise<null | {
 *   design: { board, generation, roomPhoto, snapshot },
 *   room: string | null,            // the request room id the design is for
 *   images: { kind, publicId, deliveryType, format, width, height }[]
 * }>}
 */
export async function resolveRequestDesign({ userId, boardId = null, generationId = null }) {
  if (!boardId && !generationId) return null

  if (generationId) {
    const generation = await DesignGeneration.findOne({ _id: generationId, user: userId })
    if (!generation || generation.status === 'deleted') throw notFound()
    if (boardId && String(generation.board) !== String(boardId)) throw notFound()

    if (generation.status !== 'succeeded' || !generation.result?.publicId) {
      throw new ServiceRequestDesignError(
        'VISUALIZATION_NOT_READY',
        'This visualization is not finished yet.'
      )
    }

    const images = [{
      kind: 'visualization',
      publicId: generation.result.publicId,
      deliveryType: generation.result.deliveryType,
      format: generation.result.format,
      width: generation.result.width,
      height: generation.result.height,
    }]

    // Optional: the photo may already have expired or been removed by the user.
    const photo = await DesignRoomPhoto.findOne({ _id: generation.roomPhoto, user: userId, status: 'ready' })
    if (photo) {
      images.unshift({
        kind: 'room_photo',
        publicId: photo.asset.publicId,
        deliveryType: photo.asset.deliveryType,
        format: photo.asset.format,
        width: photo.width,
        height: photo.height,
      })
    }

    const snapshot = designSnapshotOf(generation.boardSnapshot)
    return {
      design: {
        board: generation.board,
        generation: generation._id,
        roomPhoto: generation.roomPhoto,
        snapshot,
      },
      room: DESIGN_ROOM_TO_REQUEST_ROOM[snapshot.room] ?? null,
      images,
    }
  }

  const board = await DesignBoard.findOne({ _id: boardId, user: userId })
  if (!board) throw notFound()

  const snapshot = designSnapshotOf(board)
  return {
    design: { board: board._id, generation: null, roomPhoto: null, snapshot },
    room: DESIGN_ROOM_TO_REQUEST_ROOM[snapshot.room] ?? null,
    images: [],
  }
}
