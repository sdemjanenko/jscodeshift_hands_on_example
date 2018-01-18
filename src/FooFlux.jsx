import _ from "underscore";
import flux from "flux.js";
import CurrentUserStore from "stores/CurrentUserStore";
CurrentUserStore(flux);

import React from "react";
import ReactDOM from "react-dom";
import Fluxxor from "fluxxor";
var FluxMixin = Fluxxor.FluxMixin(React);
var StoreWatchMixin = Fluxxor.StoreWatchMixin;

var FluxFoo = React.createClass({
  mixins: [FluxMixin, StoreWatchMixin("CurrentUserStore")],
  getStateFromFlux() {
    const flux = this.getFlux();
    return flux.store("CurrentUserStore").getState();
  },
  render() {
    var orgs = _.map(this.state.user.administered_orgs, (org) => {
      return <li>{ org.name }</li>;
    });

    return (<div>
      <h1>Hello { this.state.user.name }</h1>
      <ul>
        { orgs }
      </ul>
    </div>);
  },
});

window.App = ReactDOM.render(<FluxFoo flux={ flux } />, document.getElementById("sidetabs_body_container"));
