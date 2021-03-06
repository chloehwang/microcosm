import React from 'react'

const Graphic = ({ section, graphicUrl }) => (
  <figure
    id={section}
    className="section__graphic__figure"
    data-module="ObserveGraphic"
    data-section={section}
  >
    <img src={graphicUrl} alt="TODO" />
  </figure>
)

export default Graphic
