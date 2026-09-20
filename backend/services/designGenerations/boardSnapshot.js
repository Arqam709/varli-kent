// The historical receipt of a design, taken from the user's OWN board document.
//
// Never built from request input. The client sends a board id; the route loads
// that board scoped by owner, and this turns the stored document into the
// snapshot. So a client cannot describe a design it does not own, cannot
// invent finishes outside the Studio Palette vocabulary, and cannot change
// what a past generation says it used.
//
// The rules are not re-invented here: the snapshot goes through
// validateDesignBoardPayload, the same validator the board API itself uses, so
// the two can never drift apart.

import { validateDesignBoardPayload } from '../designBoards.js'
import { DESIGN_BOARD_VERSION } from '../../config/designBoardVocabulary.js'

export class BoardSnapshotError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BoardSnapshotError'
  }
}

const finish = (value) => ({ label: value.label, color: value.color })

/**
 * @param {object} board a DesignBoard document (or lean object) the caller has
 *   ALREADY confirmed belongs to the requesting user
 * @returns {object} the snapshot to store on the generation
 * @throws {BoardSnapshotError} when the stored board cannot produce a valid
 *   snapshot — a board written before a vocabulary change, for example
 */
export function buildBoardSnapshot(board) {
  if (!board || typeof board !== 'object') throw new BoardSnapshotError('A board document is required')

  // Only what affects a visualization. No _id, user, clientId, timestamps or
  // Mongo metadata: the generation already records who owns it and which board
  // it came from.
  const candidate = {
    room: board.room,
    style: board.style,
    wall: board.wall ? finish(board.wall) : undefined,
    floor: board.floor ? finish(board.floor) : undefined,
    materials: (board.materials ?? []).map((material) => (
      material.image
        ? { name: material.name, color: material.color, image: material.image }
        : { name: material.name, color: material.color }
    )),
    lighting: board.lighting,
  }

  const { errors, value } = validateDesignBoardPayload(candidate)
  if (errors.length > 0) throw new BoardSnapshotError(errors[0])

  // The board's own version travels with the snapshot, so a future board
  // format can be told apart from this one without guessing.
  return { version: board.version ?? DESIGN_BOARD_VERSION, ...value }
}
