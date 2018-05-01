// We use for-await pattern quite extensively here for legitimate purposes
/* eslint-disable no-await-in-loop */

import path from 'path'
import pino from 'pino'
import {
  defaultsDeep as defaults,
  isPlainObject,
} from 'lodash'
import hidden from 'local-scope/create'
import { FrameworkError } from '@atlas.js/errors'
import {
  expose,
  dispatch,
  component,
  mkconfig,
  mklog,
  optrequire,
} from './private'

/**
 * This class represents your application and aggregates all components together
 *
 * You should generally create only one instance of this class in a program.
 */
class Atlas {
  static defaults = {
    log: {
      name: path.basename(process.cwd()),
      level: 'info',
      serializers: {
        err: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
      },
    },
  }

  /**
   * Initialise a brand-new atlas instance from the given module locations
   *
   * @param     {Object}      options                       Configuration options
   * @param     {String}      options.env                   The environment under which to operate
   * @param     {String}      options.root                  The root directory to which all other
   *                                                        directories mentioned here are relative
   * @param     {String}      options.config='config'       Module location for the configuration
   * @param     {String}      options.hooks='hooks'         Module location for the hooks
   * @param     {String}      options.services='services'   Module location for the services
   * @param     {String}      options.actions='actions'     Module location for the actions
   * @param     {String}      options.aliases='aliases'     Module location for the aliases
   * @return    {Atlas}
   */
  static init(options = {}) {
    defaults(options, {
      config: 'config',
      hooks: 'hooks',
      services: 'services',
      actions: 'actions',
      aliases: 'aliases',
    })

    const atlas = new this({
      env: options.env,
      root: options.root,
      config: options.config,
    })
    const types = [
      'hooks',
      'services',
      'actions',
      'aliases',
    ]
    const paths = {}
    const modules = {}

    for (const type of types) {
      paths[type] = path.resolve(options.root, options[type])
      modules[type] = atlas.require(options[type], { optional: true })
    }

    defaults(modules, {
      aliases: {
        actions: {},
        hooks: {},
        services: {},
      },
    })

    atlas.log.debug({
      env: atlas.env,
      root: atlas.root,
      paths,
      components: {
        actions: Object.keys(modules.actions),
        hooks: Object.keys(modules.hooks),
        services: Object.keys(modules.services),
      },
    }, 'atlas:init')

    // Hooks
    for (const [alias, Hook] of Object.entries(modules.hooks)) {
      const aliases = modules.aliases.hooks[alias]
      atlas.hook(alias, Hook, { aliases })
    }

    // Services
    for (const [alias, Service] of Object.entries(modules.services)) {
      const aliases = modules.aliases.services[alias]
      atlas.service(alias, Service, { aliases })
    }

    // Actions
    for (const [alias, Action] of Object.entries(modules.actions)) {
      const aliases = modules.aliases.actions[alias]
      atlas.action(alias, Action, { aliases })
    }

    return atlas
  }


  /**
   * The current environment under which this instance operates
   *
   * Defaults to NODE_ENV from the environment.
   *
   * @readonly
   * @return    {String}
   */
  get env() {
    return this::hidden().env
  }

  /**
   * The root folder where all other paths should be relative to
   *
   * It is recommended that you set this to the project's root directory.
   *
   * @readonly
   * @return    {String}
   */
  get root() {
    return this::hidden().root
  }

  /**
   * Is this instance in a prepared state?
   *
   * @readonly
   * @return    {boolean}
   */
  get prepared() {
    return this::hidden().prepared
  }

  /**
   * Is this instance in a started state?
   *
   * @readonly
   * @return    {boolean}
   */
  get started() {
    return this::hidden().started
  }

  /**
   * Atlas configuration, as passed in to the constructor
   *
   * @type    {Object}
   */
  config = {}

  /**
   * All services added to this instance
   *
   * @type    {Object}
   */
  services = {}

  /**
   * All actions added to this instance
   *
   * @type    {Object}
   */
  actions = {}

  /**
   * Create a new instance
   *
   * @param     {Object}    options             Options for the instance
   * @param     {Object}    options.config      Configuration object for the instance and for all
   *                                            services or other components which will be added to
   *                                            the instance
   * @param     {String}    options.root        The root directory of the instance
   * @param     {String}    options.env         The environment under which this instance operates.
   *                                            Components may use this value for various purposes.
   *                                            Defaults to NODE_ENV.
   */
  constructor(options = {}) {
    // Initialise private stuff
    // eslint-disable-next-line no-process-env
    this::hidden().env = options.env || process.env.NODE_ENV
    this::hidden().root = options.root
    this::hidden().prepared = false
    this::hidden().started = false
    this::hidden().catalog = {
      services: new Map(),
      hooks: new Map(),
      actions: new Map(),
    }
    this::hidden().observers = new Map()

    // Safety checks
    if (!this.env) {
      throw new FrameworkError('env not specified and NODE_ENV was not set')
    }

    if (typeof this.root !== 'string') {
      throw new FrameworkError(`root must be explicitly specified, got ${options.root}`)
    }

    this.config = this::mkconfig(options.config, {
      atlas: Atlas.defaults,
      services: {},
      hooks: {},
      actions: {},
    })
    // Logger 🌲
    this.log = this::mklog(this.config.atlas.log)
  }

  /**
   * Require a module by path, relative to the project root
   *
   * @param     {String}    location          The module's location, relative to root
   * @param     {Object}    options={}        Options
   * @param     {Boolean}   options.optional  If true, will not throw if the module does not exist
   * @param     {Boolean}   options.normalise If true, it will prefer the ES modules' default export
   *                                          over named exports or the CommonJS exports
   * @param     {Boolean}   options.absolute  If true, will try to load the module without
   *                                          resolving the module's name to the project root (it
   *                                          will load the module using standard Node's mechanism)
   * @return    {mixed}                       The module's contents
   */
  require(location, options = {}) {
    location = options.absolute
      ? location
      : path.resolve(this.root, location)

    const load = options.optional
      ? optrequire
      : require
    const contents = load(location)

    return options.normalise && isPlainObject(contents.default)
      ? contents.default
      : contents
  }

  /**
   * Register a service into this atlas at given alias
   *
   * @param     {String}    alias           The alias for the service - it will be used for exposing
   *                                        the service's API on the atlas.services object and for
   *                                        passing configuration data to it
   * @param     {class}     Component       The service class
   * @param     {Object}    opts            Runtime options for the service
   * @param     {Object}    opts.aliases    Bindings to other defined components
   * @return    {this}
   */
  service(alias, Component, opts = {}) {
    this::component({
      type: 'service',
      alias,
      Component,
      aliases: opts.aliases,
    }, this::hidden().catalog.services)

    return this
  }

  /**
   * Register a hook into this atlas using given alias
   *
   * @param     {String}    alias           The alias for the hook - it will be used for passing
   *                                        configuration data to it
   * @param     {class}     Component       The hook class
   * @param     {Object}    opts            Runtime options for the hook
   * @param     {Object}    opts.aliases    Bindings to other defined components
   * @return    {this}
   */
  hook(alias, Component, opts = {}) {
    this::component({
      type: 'hook',
      alias,
      Component,
      aliases: opts.aliases,
    }, this::hidden().catalog.hooks)

    return this
  }

  /**
   * Register an action into this atlas at given alias
   *
   * @param     {String}    alias           The alias for the action - it will be used for exposing
   *                                        the action's API on the atlas.actions object and for
   *                                        passing configuration data to it
   * @param     {class}     Component       The action class
   * @param     {Object}    opts            Runtime options for the action
   * @param     {Object}    opts.aliases    Bindings to other defined components
   * @return    {this}
   */
  action(alias, Component, opts = {}) {
    this::component({
      type: 'action',
      alias,
      Component,
      aliases: opts.aliases,
    }, this::hidden().catalog.actions)

    return this
  }

  /**
   * Prepare all services and hooks for use
   *
   * Generally you should use `atlas.start()` instead to get your instance up and running. However,
   * sometimes it is necessary to get all the services into a "get-ready" state before they start
   * connecting to remote resources or doing any intensive I/O operations.
   *
   * @return    {Promise<this>}
   */
  async prepare() {
    if (this.prepared) {
      return this
    }

    const { services, actions, hooks } = this::hidden().catalog
    const observers = this::hidden().observers

    for (const [alias, container] of hooks) {
      if (!container.Component.observes) {
        throw new FrameworkError(`Hook ${alias} does not have static 'observes' property`)
      }

      // Prepare observers of Atlas itself
      if (container.Component.observes === 'atlas') {
        observers.set(alias, container)
      }
    }

    // Prepare hooks
    await Promise.all(Array.from(hooks).map(([, container]) =>
      container.prepare()))

    // Prepare actions, in parallel 💪
    await Promise.all(Array.from(actions).map(async ([alias, container]) =>
      this::expose('actions', alias, await container.prepare({ hooks }))))

    // Prepare all services, in parallel 💪
    await Promise.all(Array.from(services).map(async ([alias, container]) =>
      this::expose('services', alias, await container.prepare({ hooks }))))

    this::hidden().prepared = true
    await observers::dispatch('afterPrepare', this)

    return this
  }

  /**
   * Start all services
   *
   * @return    {Promise<this>}
   */
  async start() {
    const { actions, services, hooks } = this::hidden().catalog
    const observers = this::hidden().observers

    await this.prepare()
    await observers::dispatch('beforeStart', this)

    await Promise.all([
      ...Array.from(hooks),
      ...Array.from(actions),
    ].map(([, container]) => container.start({ hooks })))

    // Start all services, in the order they were added to the instance 💪
    // Ordering is important here! Some services should be started as the last ones because they
    // expose some functionality to the outside world and starting those before ie. a database
    // service is started might break stuff!
    for (const [alias, container] of services) {
      try {
        await container.start({ instance: this.services[alias], hooks })
      } catch (err) {
        // Roll back
        await this.stop()
          // Shit just got serious 😱
          .catch(stopErr => void this.log.fatal({ err: stopErr }, 'atlas:start:rollback-failure'))

        // Re-throw the original error which caused Atlas to fail to start
        throw err
      }
    }

    this::hidden().started = true
    await observers::dispatch('afterStart', this)
    this.log.info('atlas:ready')

    return this
  }

  /**
   * Stop all services, unregister all actions and hooks and unpublish any APIs exposed by them
   *
   * This puts the whole application into a state as it was before `atlas.prepare()` and/or
   * `atlas.start()` was called.
   *
   * @return    {Promise<this>}
   */
  async stop() {
    const { services, actions, hooks } = this::hidden().catalog
    const observers = this::hidden().observers

    await observers::dispatch('beforeStop', this)

    await Promise.all([
      ...Array.from(hooks),
      ...Array.from(actions),
    ].map(([, container]) => container.stop()))

    let error

    // Stop all services, in the reverse order they were added to the instance 💪
    // This will make sure the most important services are stopped first.
    for (const [alias, container] of Array.from(services).reverse()) {
      try {
        const instance = this.services[alias]
        delete this.services[alias]
        await container.stop({ instance, hooks })
      } catch (err) {
        error = err
        // Leave this service as is and move to the next service. We probably cannot do anything to
        // properly stop this service. 🙁
      }
    }

    // Unregister actions
    for (const [alias] of actions) {
      delete this.actions[alias]
    }

    this::hidden().started = false
    this::hidden().prepared = false

    await hooks::dispatch('afterStop', null)
    this.log.info('atlas:stopped')

    // If there was an error thrown in one of the services during .stop(), re-throw it now
    if (error) {
      throw error
    }

    return this
  }
}

export default Atlas
