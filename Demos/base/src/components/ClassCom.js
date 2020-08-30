import React, { Component } from "react"


class ClassCom extends Component {
    constructor(props, context) {
        console.log("ClassCom -> constructor -> context", context)
        super(props);
        this.state = {
            count: 0,
        }
        console.log("运行constructor函数")
    }
    addCount = () => {
        this.setState((state) => {
            return {
                count: state.count++
            }
        })
    }
    render() {
        console.log("运行render函数")
        return (
            <>
                <button onClick={this.addCount}>addCount</button>
                <div>date--- {this.state.count}</div>
            </>
        )
    }
    componentDidMount() {
        console.log("class com  did mount已经绑定")
    }
    // componentWillMount() {
    //     console.log("class com will mount 即将绑定")
    // }
    // componentWillUpdate() {
    //     console.log("class com will update将要更新")
    // }
    componentDidUpdate() {
        console.log("class com did update更新完毕")
    }
    componentWillUnmount() {
        console.log("class com will unmount 将要解绑")
    }
    static getDerivedStateFromProps() {
        console.log("接受属性");
        return {}
    }
    shouldComponentUpdate() {
        // 返回false 则组件不会进行更新 即后续不会运行render函数 getSnapshotBeforeUpdate didUpdate钩子函数
        console.log("组件此次是否应该被更新")
        return true;
    }
    getSnapshotBeforeUpdate(prevProps, prevState) {
        console.log("getSnapshotBeforeUpdate")
        return null;
    }
    static getDerivedStateFromError() {
        console.log("处理错误")
    }
    componentDidCatch() {
        console.log("did catch 捕获错误")
    }
}

export default ClassCom;