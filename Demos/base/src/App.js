import React, { useState, createContext } from 'react';
import ClassCom from "./components/ClassCom"
import FuncCom from "./components/FuncCom"
import { themes } from "./components/Themes"
import ThemeContext from "./components/ThemeContext"
import TestSource from "./components/TestSource"


function App() {
    let [theme, setTheme] = useState(themes.dark);
    function toggleTheme() {
        setTheme({
            ...themes.dark,
            a:"aaa"
        })
    }
    return (
        <>
            {/* <button onClick={toggleTheme}>toggleTheme</button>
            <ThemeContext.Provider value={theme}>
                <div className="App">
                    react
            <ClassCom />
                    <FuncCom name="13" />
                </div>
            </ThemeContext.Provider> */}
            {/* <p>{JSON.stringify(theme)}</p>
            <button onClick={toggleTheme}>toggle</button> */}
            <TestSource></TestSource>
        </>

    );
}

export default App;
