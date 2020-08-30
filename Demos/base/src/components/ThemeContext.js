import React, { createContext } from "react"
import { themes } from "./Themes"

const ThemeContext = React.createContext(themes.light);


export default ThemeContext;