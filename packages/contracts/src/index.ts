// Single source of truth for shapes that cross the FE ⇄ BE ⇄ agent boundary.
// Each schema is the runtime validator; the matching `z.infer` type is the
// compile-time shape. Never redefine these in api/ or web/ — import them.
//
// Prefer importing from the subpath exports (`@handshake-agent/contracts/dto`)
// in the web app so Next can tree-shake unused intents/tools.

export * from './common'
export * from './intents/index'
export * from './tools/index'
export * from './dto/index'
export * from './whatsapp/inbound'
export * from './auth/index'
export * from './chat/index'
export * from './beneficiaries/index'
export * from './transactions/index'
export * from './media'
export * from './admin/index'
