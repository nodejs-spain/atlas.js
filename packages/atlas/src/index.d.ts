declare module '@atlas.js/atlas' {
  import * as errors from '@atlas.js/errors'
  import { Ajv } from 'ajv'
  import { Pino } from 'pino'

  interface Config {
    atlas: {
      /** Default configuration options for Atlas' pino logger */
      log: {
        name: string,
        level: string,
      }
    }
  }

  /**
   * The main point of interaction with Atlas.
   */
  export class Atlas {
    /**
     * Default values for configuration options which Atlas accepts.
     */
    static readonly defaults: Config['atlas']

    /** Current execution environment (usually mirrors NODE_ENV) */
    readonly env: string

    /**
     * The root folder where all other paths should be relative to
     *
     * It is recommended that you set this to the project's root directory.
    */
    readonly root: string

    /** Is this instance in a prepared state? */
    readonly prepared: boolean

    /** Is this instance in a started state? */
    readonly started: boolean

    /** Atlas configuration, as passed in to the constructor */
    readonly config: Config

    /** All services added to this instance */
    readonly services: object

    /** All actions added to this instance */
    readonly actions: object

    /** An instance of Ajv used to validate component configuration */
    validator: Ajv

    /** Logger used throughout Atlas and its components */
    log: Pino

    constructor()

    require(): object

    service(): Atlas

    hook(): Atlas

    action(): Atlas

    prepare(): Promise<Atlas>

    start(): Promise<Atlas>

    stop(): Promise<Atlas>
  }

  export { default as Action } from '@atlas.js/action'
  export { default as Service } from '@atlas.js/service'
  export { default as Hook } from '@atlas.js/hook'
  export { errors }
}
