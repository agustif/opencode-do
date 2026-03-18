declare global {
  interface Env {
    GLOBAL_EVENT: DurableObjectNamespace<DurableObject>
  }
}

export {}
