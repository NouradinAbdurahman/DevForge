// Credential backend interface contract.
//
// Every backend must implement exactly these methods:
//   set(provider, key)      -> void
//   get(provider)           -> string | null
//   remove(provider)        -> boolean
//   list()                  -> string[]
//   exists(provider)        -> boolean
//   test()                  -> { ok, reason? }
//   location()              -> string
//
// The AI Credential Manager calls only these methods. It never directly
// calls `security`, `secret-tool`, `cmdkey`, or any OS credential API.
// Those belong only inside the specific backend implementation.
//
// This file defines the interface as a class that other backends extend.
// It is never instantiated directly — it serves as documentation and a
// contract check (backends that forget a method fail loudly).

export class CredentialBackend {
    set(_provider, _key) { throw new Error("set() not implemented"); }
    get(_provider) { throw new Error("get() not implemented"); }
    remove(_provider) { throw new Error("remove() not implemented"); }
    list() { throw new Error("list() not implemented"); }
    exists(_provider) { throw new Error("exists() not implemented"); }
    test() { throw new Error("test() not implemented"); }
    location() { throw new Error("location() not implemented"); }
}
