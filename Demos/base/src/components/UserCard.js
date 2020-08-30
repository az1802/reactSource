import React from "react";


// export default class UserCard extends React.pureComponent {
//     constructor(props) {
//         super(props);
//     }
//     render() {
//         return (
//             <div>
//                 <p>{Math.random()}</p>
//                 {JSON.stringify(this.props.useInfo)}
//             </div>
//         )
//     }
// }


export default React.memo(props => {
    return (
        <div>
            <p>{Math.random()}</p>
            {JSON.stringify(props.useInfo)}
        </div>
    )
})

// export default function (props) {
//     return (
//         <div>
//             <p>{Math.random()}</p>
//             {JSON.stringify(props.useInfo)}
//         </div>
//     )
// }