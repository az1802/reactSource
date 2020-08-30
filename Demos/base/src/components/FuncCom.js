import React, { useState, useEffect, useContext, useReducer, useRef, useCallback, useMemo } from "react"
import ThemeContext from "./ThemeContext"
import UserCard from "./UserCard"

function reducer(state, action) {
    switch (action.type) {
        case 'increment':
            return { count: state.count + 1 };
        case 'decrement':
            return { count: state.count - 1 };
        default:
            throw new Error("action 必须要包含相关type");
    }
}



function FuncCom(props, context) {
    console.log("FuncCom -> context", context)
    let [count, setCount] = useState(1)
    let add = () => {
        setCount(++count)
    }
    const ThemeValue = useContext(ThemeContext);
    console.log("FuncCom -> value", ThemeValue)
    useEffect(() => {
        console.log("watch effect 副作用");
        return () => {
            console.log("副作用函数执行时先执行此函数")
        }
    }, [count])

    const [countState, dispatch] = useReducer(reducer, { count: 0 });

    let refDom = useRef(null)

    let [count2, setCount2] = useState(0);
    const handleClickBtn = useCallback(
        () => {
            setCount2(count2 + 1)
        },
        [count2],
    )

    const handleClickBtnMemo = useCallback(
        () => {
            setCount2(count2 + 1)
        },
        [count2],
    )
    const useInfo = useMemo(() => {
        return {
            age: count
        }
    }, [count])
    return (
        <> <div>function com</div>
            <button onClick={add}>addCount</button>
            <p>{JSON.stringify(ThemeValue)}</p>
            <p style={ThemeValue.theme}>theme</p>
            <p>---------------useReducer-------------------</p>
            <button onClick={() => dispatch({ type: 'increment' })}>++</button>
            <p>stateCount ---- {countState.count}</p>
            <p>---------------ref-----</p>
            <button onClick={() => { console.log(refDom) }} ref={refDom}>log ref</button>
            <p>---------useCallback-----------</p>
            <p>count2-----{count2}</p>
            <button onClick={handleClickBtn}>Button2</button>
            <p>---------useMemo-----------</p>
            <button onClick={handleClickBtnMemo}>handleClickBtnMemo</button>
            <UserCard useInfo={useInfo}></UserCard>
        </>

    )
}


export default FuncCom;