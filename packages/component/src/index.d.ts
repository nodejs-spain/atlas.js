declare module '@atlas.js/component' {
  import { Atlas } from '@atlas.js/atlas'

  export default class Component {
    /** By default, a component is marked as "public", ie. accessible on the Atlas instance */
    static internal: boolean
    /** Default configuration for this component */
    static defaults: object
    /** Array of component aliases which this component consumes/requires */
    static requires: Array<string>

    atlas: Atlas
  }
}
